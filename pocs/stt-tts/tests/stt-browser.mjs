// Headless Chrome: fake mic = Korean multi-sentence WAV → confirm separate sentence bubbles.
// usage: node stt-tts/tests/stt-browser.mjs [auto|live|chunked] [seconds]
import { launch, shot, BASE } from "./launch.mjs";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const mode = process.argv[2] ?? "auto";
const secs = Number(process.argv[3] ?? 32);
const shared = "fixtures/audio";
const sharedWav = existsSync(shared) ? readdirSync(shared).find((f) => f.endsWith("-16k.wav")) : null;
const wav = path.resolve(process.env.WAV ?? (sharedWav && process.env.USE_SHARED ? path.join(shared, sharedWav) : "stt-tts/tests/fixtures/pitch-ko-16k.wav"));
const tag = process.env.TAG ? `-${process.env.TAG}` : "";
const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: wav });
const out = {};
try {
  await page.goto(`${BASE}/stt-tts`, { waitUntil: "networkidle0" });
  if (mode !== "auto") await page.click(`[role=radiogroup][aria-label="전사 방식"] button:nth-child(${mode === "live" ? 2 : 3})`);
  const t0 = Date.now();
  await page.click("[data-testid=stt-start]");
  let midShot = false;
  const timeline = [];
  let lastCount = 0;
  while (Date.now() - t0 < secs * 1000) {
    await new Promise((r) => setTimeout(r, 250));
    const snap = await page.$$eval("[data-testid=sentence]", (els) => els.map((e) => ({ s: e.getAttribute("data-status"), t: e.innerText.replace(/\n/g, " | ") })));
    const finals = snap.filter((x) => x.s === "final").length;
    if (finals !== lastCount) { timeline.push({ at: ((Date.now() - t0) / 1000).toFixed(1), finals, last: snap.filter((x) => x.s === "final").pop()?.t }); lastCount = finals; }
    if (!midShot && snap.some((x) => x.s === "partial" && !x.t.includes("말하는 중") && !x.t.includes("전사 중") && x.t.length > 14) && finals >= 1) { await shot(page, `.verify/stt-tts/stt-${mode}${tag}-partial.png`); midShot = true; out.partialSeen = snap.filter((x) => x.s === "partial").map((x) => x.t); }
  }
  out.engine = await page.$eval("[data-testid=stt-engine]", (e) => e.textContent).catch(() => null);
  await shot(page, `.verify/stt-tts/stt-${mode}${tag}-running.png`);
  await page.click("[data-testid=stt-stop]");
  await page.waitForFunction(() => !document.querySelector("[data-testid=stt-stop]"), { timeout: 20000 });
  out.sentences = await page.$$eval("[data-testid=sentence][data-status=final]", (els) => els.map((e) => e.innerText.replace(/\n/g, " | ")));
  out.metrics = await page.$eval("[data-testid=stt-metrics]", (e) => e.textContent);
  out.status = await page.$eval("[data-testid=stt-status]", (e) => e.textContent);
  out.timeline = timeline;
  await shot(page, `.verify/stt-tts/stt-${mode}${tag}-done.png`, { fullPage: true });
} finally {
  out.errors = logs.filter((l) => /error|pageerror|requestfailed/i.test(l));
  writeFileSync(`.verify/stt-tts/stt-${mode}${tag}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}
