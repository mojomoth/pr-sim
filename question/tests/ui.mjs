#!/usr/bin/env node
// Headless Chrome E2E for /question (real provider calls). Screenshots → .verify/question/
// usage: node question/tests/ui.mjs [mobile|desktop] [--mic]
//   --mic: answer the first question by voice (fake mic = fixtures/audio/answer-ko-16k.wav, Live STT)
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { launch, shot, BASE } from "../../stt-tts/tests/launch.mjs";

const mode = process.argv[2] === "desktop" ? "desktop" : "mobile";
const useMic = process.argv.includes("--mic");
const OUT = `.verify/question/${mode}${useMic ? "-mic" : ""}`;
mkdirSync(OUT, { recursive: true });
const wav = path.resolve("fixtures/audio/answer-ko-16k.wav");
const { browser, page, logs } = await launch({ mobile: mode === "mobile", fakeAudioWav: useMic ? wav : undefined });
const report = { mode, useMic, steps: [], tts: [], api: [] };
const step = (name, extra = {}) => {
  const s = { name, t: Date.now(), ...extra };
  report.steps.push(s);
  console.log(`- ${name}`, Object.keys(extra).length ? JSON.stringify(extra) : "");
};
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/api/question/")) report.api.push({ url: u.replace(BASE, ""), status: r.status() });
  if (u.endsWith("/api/question/tts")) report.tts.push({ status: r.status(), cache: r.headers()["x-cache"], voice: r.headers()["x-voice"], model: r.headers()["x-model"], ms: r.headers()["x-ms"] });
});
const clickText = async (text, sel = "button") => {
  const ok = await page.evaluate(
    (text, sel) => {
      const el = [...document.querySelectorAll(sel)].find((b) => b.textContent?.includes(text) && !b.disabled);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    },
    text,
    sel,
  );
  if (!ok) throw new Error(`button not found: ${text}`);
};
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

try {
  const t0 = Date.now();
  await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
  await page.waitForSelector('[data-testid="judge-card"]', { timeout: 20000 });
  step("loaded", { ms: Date.now() - t0, overflow: await overflow() });
  // connect generated faces if available
  try {
    await clickText("생성된 얼굴 자동 연결");
    await new Promise((r) => setTimeout(r, 1200));
    step("faces-connected");
  } catch {
    step("no-faces");
  }
  await shot(page, `${OUT}/1-setup.png`);
  await shot(page, `${OUT}/1-setup-full.png`, { fullPage: true });

  const tg = Date.now();
  await clickText("질문 생성");
  await page.waitForSelector('[data-testid="question-partial"], [data-testid="question"]', { timeout: 60000 });
  step("first-partial", { ms: Date.now() - tg });
  await page.evaluate(() => document.querySelector('[data-testid="stages"]')?.scrollIntoView({ block: "start" }));
  await shot(page, `${OUT}/2-streaming.png`);
  await page.waitForSelector('[data-testid="start-qa"]', { timeout: 120000 });
  const nQ = await page.$$eval('[data-testid="question"]', (els) => els.length);
  step("generated", { ms: Date.now() - tg, questions: nQ, overflow: await overflow() });
  await page.evaluate(() => document.querySelector('[data-testid="stages"]')?.scrollIntoView({ block: "start" }));
  await shot(page, `${OUT}/3-generated.png`);
  // expand first evidence
  await page.evaluate(() => document.querySelector('[data-testid="question"] details')?.setAttribute("open", ""));
  await page.evaluate(() => document.querySelector('[data-testid="question"] details')?.scrollIntoView({ block: "center" }));
  await shot(page, `${OUT}/4-evidence.png`);
  await page.evaluate(() => document.querySelector('[data-testid="context-inspector"]')?.scrollIntoView({ block: "start" }));
  await shot(page, `${OUT}/5-inspector.png`);
  await shot(page, `${OUT}/5-full.png`, { fullPage: true });

  await page.click('[data-testid="start-qa"]');
  await page.waitForSelector('[data-testid="current-question"]', { timeout: 10000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.querySelector('[data-testid="qa-stage"]')?.scrollIntoView({ block: "start" }));
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, `${OUT}/6-qa.png`);
  const q1 = await page.$eval('[data-testid="current-question"]', (e) => e.textContent);
  step("qa-started", { q1 });
  // wait for TTS request to finish (or fail) — up to 40s
  for (let i = 0; i < 80 && !report.tts.length; i++) await new Promise((r) => setTimeout(r, 500));
  step("tts", report.tts[0] ?? { none: true });

  // answer 1: weak (typed) or by voice
  if (useMic) {
    await page.click('button[aria-label="마이크로 답변"]');
    step("mic-on");
    await new Promise((r) => setTimeout(r, 6000));
    await shot(page, `${OUT}/7-mic-listening.png`);
    await new Promise((r) => setTimeout(r, 14000));
    const heard = await page.$eval('textarea[aria-label="답변"]', (e) => e.value);
    step("mic-heard", { heard });
  } else {
    await page.type('textarea[aria-label="답변"]', "아 그게… 기준이 좀 달라서요. 아마 초기 수치가 반영된 것 같고, 어쨌든 앞으로 계속 좋아질 겁니다.");
  }
  const ta = Date.now();
  await clickText("답변 완료");
  await page.waitForSelector('[data-testid="last-assessment"]', { timeout: 60000 });
  const a1 = await page.$eval('[data-testid="last-assessment"]', (e) => e.textContent);
  const cur1 = await page.$eval('[data-testid="current-question"]', (e) => e.textContent).catch(() => null);
  step("answer-1", { ms: Date.now() - ta, assessment: a1, next: cur1 });
  await page.evaluate(() => document.querySelector('[data-testid="qa-stage"]')?.scrollIntoView({ block: "start" }));
  await new Promise((r) => setTimeout(r, 800));
  await shot(page, `${OUT}/8-after-answer1.png`);

  // answer 2: strong
  if (cur1) {
    // a strong, on-topic answer for whatever the judge asked
    const STRONG = [
      [/원가|마진|이익률|118|142/, "현재 양산 원가는 제안서의 142원, 매출총이익률은 약 14%가 맞습니다. 원료 18원, 전분 22원, 에너지 31원, 인건비 38원, 물류 19원, 감가 14원입니다. 발표자료 118원은 목표치를 잘못 기재했고, 2공장 가동 후 2028년 92원이 목표입니다."],
      [/SOM|340|210|시장/, "SOM은 SAM 6,800억 원의 약 3.1%인 210억 원이 최신 기준입니다. 340억, 5%는 초기 버전 수치라 덱을 210억으로 수정하겠습니다."],
      [/./, "현재 LOI 3건이 연 환산 24억 원 규모이고, 파일럿 고객 12곳의 재구매율이 83%입니다. 월 8곳은 물류대행사 2곳을 통한 번들 영업으로 확보하며, 대행사 1곳당 고객사 4곳 전환을 가정했습니다. 분기마다 전환율을 공개하고 미달 시 2공장 증설 시점을 늦추겠습니다."],
    ];
    const strong = STRONG.find(([re]) => re.test(cur1))[1];
    await page.type('textarea[aria-label="답변"]', strong);
    const tb = Date.now();
    await clickText("답변 완료");
    await page.waitForFunction((prev) => document.querySelector('[data-testid="last-assessment"]')?.textContent !== prev, { timeout: 60000 }, a1);
    const a2 = await page.$eval('[data-testid="last-assessment"]', (e) => e.textContent);
    step("answer-2", { ms: Date.now() - tb, assessment: a2 });
  }

  await clickText("세션 저장");
  await page.waitForSelector('[data-testid="saved"]', { timeout: 20000 });
  const saved = await page.$eval('[data-testid="saved"]', (e) => e.textContent);
  step("saved", { saved, items: await page.$$eval('[data-testid="qa-log-item"]', (e) => e.length) });
  await page.evaluate(() => document.querySelector('[data-testid="saved"]')?.scrollIntoView({ block: "start" }));
  await shot(page, `${OUT}/9-log-saved.png`);
  step("final", { overflow: await overflow() });
} catch (e) {
  step("FAILED", { error: String(e?.message ?? e) });
  await shot(page, `${OUT}/error.png`, { fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  report.consoleErrors = logs.filter((l) => /^\[(error|pageerror|requestfailed)\]/.test(l));
  report.logs = logs.slice(-40);
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log("console errors:", report.consoleErrors);
  await browser.close();
}
