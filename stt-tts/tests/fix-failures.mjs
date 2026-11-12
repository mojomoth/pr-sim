// Fix round 1: (B) segment-failure UX with mocked /transcribe responses (no provider quota needed).
//  A) first segment 502, later segments OK → failure bubble + red warning + "듣는 중 · 전사 실패" badge,
//     then sentences appear and the warning clears.
//  B) every segment 502 → after 3 consecutive failures transcription stops with an error + 다시 시도.
// usage: node stt-tts/tests/fix-failures.mjs
import { launch, shot, BASE } from "./launch.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = ".verify/stt-tts/fix";
mkdirSync(dir, { recursive: true });
const wav = path.resolve("fixtures/audio/speech-ko-16k.wav");
const TEXTS = ["안녕하세요. 저희 팀은 발표 연습 서비스를 만들었습니다.", "이 부분이 정말 중요합니다.", "감사합니다."];
const out = {};

const read = (page) => page.evaluate(() => ({
  status: document.querySelector("[data-testid=stt-status]")?.textContent,
  warning: document.querySelector("[data-testid=stt-warning]")?.textContent ?? null,
  error: document.querySelector("[data-testid=stt-error]")?.textContent ?? null,
  failed: [...document.querySelectorAll("[data-testid=segment-failed]")].map((e) => e.innerText.replace(/\n/g, " | ")),
  finals: [...document.querySelectorAll("[data-testid=sentence][data-status=final]")].map((e) => e.innerText.replace(/\n/g, " | ")),
}));

for (const scenario of ["first-fails", "all-fail"]) {
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: wav });
  let n = 0;
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (!r.url().includes("/api/stt-tts/transcribe")) return r.continue();
    const i = n++;
    const fail = scenario === "all-fail" || i === 0;
    setTimeout(() => r.respond(fail
      ? { status: 502, contentType: "application/json", body: JSON.stringify({ error: "테스트: Gemini 호출 실패 (502)", status: 502 }) }
      : { status: 200, contentType: "application/json", body: JSON.stringify({ text: TEXTS[(i - 1) % TEXTS.length], sentences: [] }) }), 400);
  });
  await page.goto(`${BASE}/stt-tts`, { waitUntil: "networkidle0" });
  await page.click('[role=radiogroup][aria-label="전사 방식"] button:nth-child(3)');
  await page.click("[data-testid=stt-start]");
  const timeline = [];
  const t0 = Date.now();
  let shotWarn = false;
  while (Date.now() - t0 < 30_000) {
    await new Promise((r) => setTimeout(r, 300));
    const s = await read(page);
    const key = JSON.stringify(s);
    if (timeline.at(-1)?.key !== key) timeline.push({ at: +((Date.now() - t0) / 1000).toFixed(1), key, ...s });
    if (!shotWarn && s.warning) { await shot(page, `${dir}/${scenario}-warning.png`); shotWarn = true; }
    if (s.error || (scenario === "first-fails" && s.finals.length >= 2 && !s.warning)) break;
  }
  const final = await read(page);
  await page.evaluate(() => document.querySelector("[data-testid=stt-status]")?.scrollIntoView({ block: "start" }));
  await shot(page, `${dir}/${scenario}-end.png`);
  if (await page.$("[data-testid=stt-stop]")) await page.click("[data-testid=stt-stop]");
  out[scenario] = { requests: n, final, timeline: timeline.map((t) => { const rest = { ...t }; delete rest.key; return rest; }), pageErrors: logs.filter((l) => /pageerror/.test(l)) };
  await browser.close();
}
writeFileSync(`${dir}/fix-failures.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { requests: v.requests, final: v.final, sawWarningWhileListening: v.timeline.some((t) => t.warning && /듣는 중/.test(t.status)), pageErrors: v.pageErrors }])), null, 2));
