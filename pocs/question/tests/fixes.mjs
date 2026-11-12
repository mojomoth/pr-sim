#!/usr/bin/env node
// Fix-round E2E for the reviewer's issues (real page, real providers unless noted).
// usage: node question/tests/fixes.mjs <mobile|desktop> <scenario>
//   real-flow   : real generate (provider chain) → tap 질의응답 시작 → stage position → real TTS plays →
//                 weak answer → real follow-up → screenshots
//   error-replay: generate mocked to fail like "all providers down" → Korean error card, no overflow →
//                 "최근 저장된 실행 불러오기" → questions + inspector visible (no AI calls)
//   dup-face    : two 빡셈 judges; the face judge 1 uses is disabled in judge 2's picker
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const mode = process.argv[2] === "desktop" ? "desktop" : "mobile";
const scenario = process.argv[3] ?? "real-flow";
const OUT = `.verify/question/fixes/${mode}-${scenario}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launch({ mobile: mode === "mobile" });
const rep = { mode, scenario, steps: [], api: [] };
const step = (name, extra = {}) => {
  rep.steps.push({ name, ...extra });
  console.log("-", name, JSON.stringify(extra));
};
page.on("response", (r) => {
  if (r.url().includes("/api/question/")) rep.api.push({ url: r.url().replace(BASE, ""), status: r.status(), provider: r.headers()["x-provider"] });
});
await page.evaluateOnNewDocument(() => {
  window.__plays = [];
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__plays.push({ t: Math.round(performance.now()) });
    return orig.call(this).catch(() => {});
  };
});
const clickText = (text) =>
  page.evaluate((text) => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text) && !b.disabled);
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, text);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tap = async (sel) => {
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel);
  await sleep(300);
  const r = await page.$eval(sel, (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  if (mode === "mobile") await page.touchscreen.tap(r.x, r.y);
  else await page.mouse.click(r.x, r.y);
};
const stagePos = () =>
  page.evaluate(() => {
    const q = document.querySelector('[data-testid="qa-stage"]')?.getBoundingClientRect();
    const a = document.querySelector('textarea[aria-label="답변"]')?.getBoundingClientRect();
    return { viewportH: innerHeight, qaStageTop: q && Math.round(q.top), answerTop: a && Math.round(a.top) };
  });

try {
  if (scenario === "error-replay") {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().endsWith("/api/question/generate")) {
        const msg =
          "AI 모델을 지금 쓸 수 없습니다 — Claude 사용 한도 초과(2026-12-01 재개) · OpenAI 크레딧 소진(충전 필요) · Gemini 무료 한도 초과(429). 잠시 후 다시 시도하거나 '저장된 실행 불러오기'로 이전 결과를 확인하세요.";
        const body = [
          { type: "stage", stage: "context", msg: "컨텍스트 구성 중" },
          { type: "error", judgeId: "judge-friendly-1", message: `이정민 질문 생성 실패: ${msg}` },
          { type: "error", message: `모든 심사위원의 질문 생성이 실패했습니다. ${msg}` },
        ]
          .map((e) => JSON.stringify(e))
          .join("\n");
        return req.respond({ status: 200, contentType: "application/x-ndjson", body: body + "\n" });
      }
      req.continue();
    });
  }

  await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
  await page.waitForSelector('[data-testid="judge-card"]', { timeout: 20000 });
  step("loaded", { overflow: await overflow() });

  if (scenario === "dup-face") {
    // judge 2 → 빡셈 too, give judge 1 a strict face, then open judge 2's picker
    await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="judge-card"]');
      [...cards[0].querySelectorAll('[role="radio"]')].find((b) => b.textContent.includes("빡셈")).click();
    });
    await sleep(200);
    await page.evaluate(() => document.querySelectorAll('[data-testid="judge-card"]')[0].querySelector("button").click());
    await sleep(200);
    const picked = await page.evaluate(() => {
      const b = document.querySelectorAll('[data-testid="judge-card"]')[0].querySelector('button[aria-label$="세 선택"]:not([disabled])');
      const label = b?.getAttribute("aria-label");
      b?.click();
      return label;
    });
    await sleep(300);
    // judge 2 is 박준호 (strict) in the sample
    await page.evaluate(() => document.querySelectorAll('[data-testid="judge-card"]')[1].querySelector("button").click());
    await sleep(300);
    const picker2 = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="judge-card"]')[1].querySelectorAll('button[aria-label*="세 선택"], button[aria-label*="사용 중"]')].map((b) => ({ label: b.getAttribute("aria-label"), disabled: b.disabled })),
    );
    const disabled = picker2.filter((p) => p.disabled);
    step("picker", { picked, options: picker2.length, disabled });
    await page.evaluate(() => document.querySelectorAll('[data-testid="judge-card"]')[1].scrollIntoView({ block: "center" }));
    await shot(page, `${OUT}/1-picker.png`);
    // duplicate ids via API are rejected
    const r = await page.evaluate(async () => {
      const res = await fetch("/api/question/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ judges: [{ id: "a", name: "가", temperament: "strict", gender: "male", age: 50 }, { id: "a", name: "나", temperament: "strict", gender: "male", age: 50 }] }),
      });
      return { status: res.status, body: await res.json() };
    });
    step("dup-ids-api", { status: r.status, msg: r.body.issues?.[0]?.message });
  } else {
    await clickText("질문 생성");
    if (scenario === "error-replay") {
      await page.waitForSelector('[data-testid="gen-errors"]', { timeout: 30000 });
      await sleep(400);
      const card = await page.$eval('[data-testid="gen-errors"]', (e) => {
        const b = e.getBoundingClientRect();
        const kids = [...e.querySelectorAll("p")].map((p) => p.getBoundingClientRect().right);
        return { right: Math.round(b.right), maxChildRight: Math.round(Math.max(...kids)), text: e.textContent.slice(0, 160) };
      });
      step("error-card", { ...card, overflow: await overflow() });
      await page.evaluate(() => document.querySelector('[data-testid="gen-errors"]').scrollIntoView({ block: "center" }));
      await shot(page, `${OUT}/1-error.png`);
      await page.click('[data-testid="replay-latest"]');
      await page.waitForSelector('[data-testid="start-qa"]', { timeout: 20000 });
      await sleep(800);
      const n = await page.$$eval('[data-testid="question"]', (e) => e.length);
      const stages = await page.$eval('[data-testid="stages"]', (e) => e.textContent);
      step("replayed", { questions: n, stages, inspector: !!(await page.$('[data-testid="target"]')), overflow: await overflow() });
      await shot(page, `${OUT}/2-replayed.png`);
      await page.evaluate(() => document.querySelector('[data-testid="target"]')?.scrollIntoView({ block: "start" }));
      await shot(page, `${OUT}/3-inspector.png`);
    } else {
      const t0 = Date.now();
      await page.waitForFunction(() => document.querySelector('[data-testid="start-qa"]') || document.querySelector('[data-testid="gen-errors"]'), { timeout: 180000 });
      const err = await page.$eval('[data-testid="gen-errors"]', (e) => e.textContent).catch(() => null);
      const provider = await page.$eval('[data-testid="provider"]', (e) => e.textContent).catch(() => null);
      step("generated", { ms: Date.now() - t0, err, provider, questions: await page.$$eval('[data-testid="question"]', (e) => e.length) });
      await shot(page, `${OUT}/1-generated.png`);
      if (err) throw new Error("generate failed: " + err);
      await page.evaluate(() => {
        const t = [...document.querySelectorAll('[data-testid="target"]')].find((x) => x.textContent.includes("원문에 없는 수치"));
        t?.scrollIntoView({ block: "center" });
      });
      step("unverified-target", { shown: await page.evaluate(() => [...document.querySelectorAll('[data-testid="target"]')].some((x) => x.textContent.includes("원문에 없는 수치"))) });
      await shot(page, `${OUT}/2-inspector-flag.png`);

      await tap('[data-testid="start-qa"]');
      await sleep(1500);
      step("after-start-tap", await stagePos());
      await shot(page, `${OUT}/3-after-start.png`);
      await page.waitForFunction(() => window.__plays.length > 0 || document.querySelector('[data-testid="qa-stage"]')?.textContent.includes("음성 재생 실패"), { timeout: 60000 });
      step("tts", { plays: await page.evaluate(() => window.__plays), info: await page.$eval('[data-testid="tts-info"]', (e) => e.textContent).catch(() => null) });

      await page.type('textarea[aria-label="답변"]', "아 그게… 기준이 좀 달라서요. 아마 초기 수치가 반영된 것 같습니다.");
      await clickText("답변 완료");
      await page.waitForFunction(() => document.querySelector('[data-testid="last-assessment"]') || /판단 실패/.test(document.querySelector('[data-testid="qa-stage"]')?.textContent ?? ""), { timeout: 90000 });
      await sleep(500);
      step("weak-answer", {
        assess: await page.$eval('[data-testid="last-assessment"]', (e) => e.textContent).catch(() => null),
        cur: await page.$eval('[data-testid="current-question"]', (e) => e.textContent).catch(() => null),
        err: await page.evaluate(() => [...document.querySelectorAll('[data-testid="qa-stage"] .text-error')].map((e) => e.textContent)),
      });
      await page.evaluate(() => document.querySelector('[data-testid="qa-stage"]')?.scrollIntoView({ block: "start" }));
      await shot(page, `${OUT}/4-followup.png`);
    }
  }
  step("final", { overflow: await overflow() });
} catch (e) {
  step("FAILED", { error: String(e?.message ?? e) });
  await shot(page, `${OUT}/error.png`, { fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  rep.consoleErrors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  writeFileSync(`${OUT}/report.json`, JSON.stringify(rep, null, 2));
  console.log("console errors:", rep.consoleErrors);
  await browser.close();
}
