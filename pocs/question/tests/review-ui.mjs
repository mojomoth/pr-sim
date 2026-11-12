#!/usr/bin/env node
// Reviewer E2E for /question. Real page + real setup; generate is REPLAYED from a recorded real NDJSON run
// (providers are out of credits at review time), TTS/followup optionally mocked to exercise the Q&A UI.
// usage: node question/tests/review-ui.mjs <mobile|desktop> <scenario> [ndjson]
//   scenarios: real-generate | qa-mock | stale-audio | mic-during-tts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const mode = process.argv[2] === "desktop" ? "desktop" : "mobile";
const scenario = process.argv[3] ?? "real-generate";
const ndjson = process.argv[4];
const OUT = `.verify/question/review/${mode}-${scenario}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wav(seconds, tag) {
  const sr = 8000, n = Math.round(sr * seconds) + tag; // tag makes size distinct
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

const { browser, page, logs } = await launch({ mobile: mode === "mobile" });
const rep = { mode, scenario, steps: [], api: [], plays: [] };
const step = (name, extra = {}) => { rep.steps.push({ name, ...extra }); console.log("-", name, JSON.stringify(extra)); };
page.on("response", (r) => { if (r.url().includes("/api/question/")) rep.api.push({ url: r.url().replace(BASE, ""), status: r.status() }); });
await page.evaluateOnNewDocument(() => {
  window.__plays = [];
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__plays.push({ t: performance.now(), src: this.src });
    return orig.call(this).catch(() => {});
  };
  // record blob sizes for blob URLs
  const oc = URL.createObjectURL;
  window.__blobSize = {};
  URL.createObjectURL = function (b) { const u = oc.call(URL, b); if (b && b.size) window.__blobSize[u] = b.size; return u; };
});

const ttsTexts = [];
if (scenario !== "real-generate") {
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const u = req.url();
    if (u.endsWith("/api/question/generate") && ndjson) {
      return req.respond({ status: 200, contentType: "application/x-ndjson", body: readFileSync(ndjson, "utf8") });
    }
    if (u.endsWith("/api/question/tts") && scenario !== "qa-real-tts") {
      const body = JSON.parse(req.postData());
      const idx = ttsTexts.push(body.text) - 1;
      // first TTS slow (simulates Gemini first-generation 7–9 s), rest fast
      const delay = idx === 0 && (scenario === "stale-audio" || scenario === "mic-during-tts") ? 5000 : 300;
      await sleep(delay);
      return req.respond({ status: 200, contentType: "audio/wav", headers: { "x-voice": "mock", "x-provider": "gemini", "x-model": "mock", "x-cache": "MISS", "x-duration": "3" }, body: wav(3, idx * 10 + 1) });
    }
    if (u.endsWith("/api/question/followup") && scenario === "qa-mock") {
      const body = JSON.parse(req.postData());
      const weak = /기준이 좀/.test(body.answer);
      await sleep(400);
      return req.respond({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          decision: weak ? "followup" : "next",
          assessment: { score: weak ? 2 : 5, verdict: weak ? "회피" : "충분", reason: weak ? "기준 차이를 설명하지 않았습니다." : "정확히 정정했습니다." },
          remark: weak ? "그건 답이 안 됩니다." : "알겠습니다.",
          followup: weak ? { id: `${body.questionId}_f1`, judgeId: body.judgeId, question: "그래서 118원과 142원 중 어느 쪽입니까?", intent: "x", targetClaim: "x", targetId: null, evidence: [{ doc: "presentation", page: 6, quote: "118원", verified: true }], difficulty: 4, kind: "followup", parentId: body.questionId } : null,
          usage: { provider: "mock", model: "mock", inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, ms: 1 }, latencyMs: 400,
        }),
      });
    }
    req.continue();
  });
}
const clickText = (text) => page.evaluate((text) => {
  const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text) && !b.disabled);
  if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true;
}, text);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const plays = () => page.evaluate(() => window.__plays.map((p) => ({ t: Math.round(p.t), size: window.__blobSize[p.src] })));

try {
  await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
  await page.waitForSelector('[data-testid="judge-card"]', { timeout: 20000 });
  step("loaded", { overflow: await overflow() });
  await shot(page, `${OUT}/1-setup.png`);
  await shot(page, `${OUT}/1-setup-full.png`, { fullPage: true });

  await clickText("질문 생성");
  if (scenario === "real-generate") {
    await page.waitForFunction(() => document.querySelector(".border-error") || document.querySelector('[data-testid="start-qa"]'), { timeout: 120000 });
    await sleep(500);
    const errText = await page.evaluate(() => document.querySelector(".border-error")?.textContent ?? null);
    step("generate-result", { errText, phaseBtn: await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent).find((t) => /생성/.test(t))) });
    await page.evaluate(() => document.querySelector(".border-error")?.scrollIntoView({ block: "center" }));
    await shot(page, `${OUT}/2-generate-error.png`);
    await shot(page, `${OUT}/2-generate-error-full.png`, { fullPage: true });
  } else {
    await page.waitForSelector('[data-testid="start-qa"]', { timeout: 30000 });
    step("generated(replayed)", { questions: await page.$$eval('[data-testid="question"]', (e) => e.length), overflow: await overflow() });
    await page.evaluate(() => document.querySelector('[data-testid="question"] details')?.setAttribute("open", ""));
    await page.evaluate(() => document.querySelector('[data-testid="question"] details')?.scrollIntoView({ block: "center" }));
    await shot(page, `${OUT}/2-evidence.png`);
    await page.evaluate(() => document.querySelector('[data-testid="context-inspector"]')?.scrollIntoView({ block: "start" }));
    await shot(page, `${OUT}/3-inspector.png`);
    await page.click('[data-testid="start-qa"]');
    await page.waitForSelector('[data-testid="current-question"]');
    const q1 = await page.$eval('[data-testid="current-question"]', (e) => e.textContent);
    step("qa-started", { q1 });

    if (scenario === "stale-audio") {
      await sleep(500);
      await clickText("건너뛰기"); // skip q1 while its TTS is still loading
      const q2 = await page.$eval('[data-testid="current-question"]', (e) => e.textContent);
      step("skipped", { q2 });
      await sleep(6500);
      const p = await plays();
      const status = await page.evaluate(() => document.querySelector('[data-testid="qa-stage"] [aria-live="polite"]')?.textContent);
      step("plays-after-skip", { ttsTexts, plays: p, lastPlayedIsQ1: p.length && p[p.length - 1].size === 44 + (8000 * 3 + 1) * 2, status });
      await shot(page, `${OUT}/4-after-skip.png`);
    } else if (scenario === "mic-during-tts") {
      await sleep(500);
      await page.click('button[aria-label="마이크로 답변"]');
      step("mic-on-before-tts-arrived");
      await sleep(6000);
      const p = await plays();
      const mic = await page.evaluate(() => document.querySelector('button[aria-label="마이크 끄기"]') != null);
      step("plays-while-mic", { plays: p, micStillOn: mic });
      await shot(page, `${OUT}/4-mic.png`);
    } else {
      // qa-mock / qa-real-followup: weak answer → followup → strong → next; then save
      await sleep(1200);
      await shot(page, `${OUT}/4-qa.png`);
      await page.type('textarea[aria-label="답변"]', "아 그게… 기준이 좀 달라서요. 아마 초기 수치가 반영된 것 같습니다.");
      await clickText("답변 완료");
      await page.waitForFunction(() => document.querySelector('[data-testid="last-assessment"]') || /실패|오류|credits/.test(document.querySelector('[data-testid="qa-stage"]')?.textContent ?? ""), { timeout: 60000 });
      await sleep(800);
      const cur = await page.$eval('[data-testid="current-question"]', (e) => e.textContent).catch(() => null);
      const err = await page.evaluate(() => [...document.querySelectorAll('[data-testid="qa-stage"] .text-error')].map((e) => e.textContent));
      step("answer-1", { cur, err, ttsTexts: ttsTexts.slice(-1) });
      await page.evaluate(() => document.querySelector('[data-testid="qa-stage"]')?.scrollIntoView({ block: "start" }));
      await shot(page, `${OUT}/5-after-weak.png`);
      if (!err.length) {
        await page.type('textarea[aria-label="답변"]', "정정드리겠습니다. 현재 원가는 142원이 맞고 118원은 목표치 오기재입니다.");
        await clickText("답변 완료");
        await sleep(1500);
        step("answer-2", { cur: await page.$eval('[data-testid="current-question"]', (e) => e.textContent).catch(() => null), assess: await page.$eval('[data-testid="last-assessment"]', (e) => e.textContent).catch(() => null) });
        await clickText("세션 저장");
        await page.waitForSelector('[data-testid="saved"]', { timeout: 20000 });
        step("saved", { saved: await page.$eval('[data-testid="saved"]', (e) => e.textContent) });
        await page.evaluate(() => document.querySelector('[data-testid="saved"]')?.scrollIntoView({ block: "start" }));
        await shot(page, `${OUT}/6-saved.png`);
      }
    }
  }
  step("final", { overflow: await overflow() });
} catch (e) {
  step("FAILED", { error: String(e?.message ?? e) });
  await shot(page, `${OUT}/error.png`, { fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  rep.consoleErrors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  rep.logs = logs.slice(-30);
  writeFileSync(`${OUT}/report.json`, JSON.stringify(rep, null, 2));
  console.log("console errors:", rep.consoleErrors);
  await browser.close();
}
