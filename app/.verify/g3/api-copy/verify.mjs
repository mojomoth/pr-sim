// G3 API copy fixes: live checks of TTS / body-cap / report-progress copy + result screen screenshots.
//   node verify.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { buildSession, seed } from "../../g2/SCREENS-C/seed.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/api-copy";
const BASE = "http://localhost:3000";
const H = { "content-type": "application/json", origin: BASE };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// 1. TTS
for (const provider of ["openai", undefined]) {
  const r = await fetch(`${BASE}/api/tts`, { method: "POST", headers: H, body: JSON.stringify({ text: "안녕하세요.", gender: "female", age: 50, temperament: "friendly", provider }) });
  out[`tts_${provider ?? "default"}`] = { status: r.status, provider: r.headers.get("x-provider"), body: r.ok ? `${(await r.arrayBuffer()).byteLength} bytes wav` : await r.json() };
}
// 2. body cap (> 4MB)
{
  const r = await fetch(`${BASE}/api/questions`, { method: "POST", headers: H, body: JSON.stringify({ pad: "x".repeat(4_100_000) }) });
  out.bodyCap = { status: r.status, body: await r.json() };
}
// 3. report stream: step labels + final error line
{
  const req = readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/api-p2/report-nowiki.req.json", "utf8");
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/report`, { method: "POST", headers: H, body: req });
  const text = await r.text();
  writeFileSync(`${OUT}/report.ndjson`, text);
  const lines = text.trim().split("\n").map((l) => JSON.parse(l));
  const steps = lines.find((l) => l.type === "steps")?.steps.map((s) => s.label);
  const details = Object.fromEntries(lines.filter((l) => l.type === "step" && l.step.detail).map((l) => [l.step.id, `${l.step.status}: ${l.step.detail}`]));
  out.report = { status: r.status, ms: Date.now() - t0, steps, details, last: lines.at(-1) };
}
console.log(JSON.stringify(out, null, 2));

// 4. browser: result progress + error card (mobile), feedback DOC_LABEL (mobile + desktop)
const report = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-C/session-with-report.json", "utf8"));
for (const dev of ["mobile", "desktop"]) {
  const mobile = dev === "mobile";
  const { browser, page, logs } = await launch({ mobile });
  if (!mobile) await page.setViewport({ width: 1440, height: 900 });
  const r = (out[`browser_${dev}`] = {});
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await seed(page, report);
    const pending = buildSession(`s_g3apicopy_${dev}`);
    await seed(page, pending);

    await page.goto(`${BASE}/result?s=${pending.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("두 자료의 수치 비교"), { timeout: 30000 }).catch(() => {});
    await sleep(1200);
    r.progressText = (await page.evaluate(() => document.body.innerText)).split("\n").filter(Boolean).slice(0, 40);
    await shot(page, `${OUT}/05-progress-${dev}.png`);
    await page.waitForFunction(() => /만들지 못했어요/.test(document.body.innerText), { timeout: 240000 });
    await sleep(800);
    r.errorText = (await page.evaluate(() => document.body.innerText)).split("\n").filter((l) => /못했어요|AI 평가|다시 시도/.test(l));
    await shot(page, `${OUT}/05-error-${dev}.png`);

    await page.goto(`${BASE}/result?s=${report.id}&tab=feedback`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.body.innerText.includes("질문별 피드백"), { timeout: 20000 });
    await sleep(1500);
    await shot(page, `${OUT}/06-feedback-${dev}.png`);
    await page.evaluate(() => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === "자료 평가")?.click());
    await sleep(1200);
    const t = await page.evaluate(() => document.body.innerText);
    r.docLabels = { spaced: (t.match(/(발표|제안) 자료[^\n]{0,12}/g) ?? []).slice(0, 12), unspacedChips: (t.match(/(발표자료|제안자료) p\.\d+/g) ?? []).slice(0, 5) };
    const chips = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? "").filter((x) => /쪽 보기/.test(x)).slice(0, 6));
    r.chipLabels = chips;
    await shot(page, `${OUT}/06-materials-${dev}.png`);
  } catch (e) {
    r.error = String(e);
    await shot(page, `${OUT}/99-error-${dev}.png`).catch(() => {});
  } finally {
    r.consoleErrors = logs.filter((l) => /error/i.test(l) && !/503|502|api\/report|api\/tts/.test(l)).slice(0, 10);
    await browser.close();
  }
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).filter(([k]) => k.startsWith("browser"))), null, 2));
