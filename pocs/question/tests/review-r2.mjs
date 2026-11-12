#!/usr/bin/env node
// Review round 2 E2E (independent reviewer). Real APIs, no mocks.
// usage: node question/tests/review-r2.mjs <mobile|desktop> <generate|replay>
//   generate: click 질문 생성 (real providers) → QA if any question
//   replay:   load the newest saved run with ≥4 questions → QA (real followup / TTS)
import { writeFileSync, mkdirSync } from "node:fs";
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const mode = process.argv[2] === "desktop" ? "desktop" : "mobile";
const scen = process.argv[3] ?? "generate";
const OUT = `.verify/question/review/r2-${mode}-${scen}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launch({ mobile: mode === "mobile" });
const rep = { mode, scen, steps: [], api: [] };
const step = (name, extra = {}) => { rep.steps.push({ name, ...extra }); console.log("-", name, JSON.stringify(extra).slice(0, 400)); };
page.on("response", async (r) => {
  if (!r.url().includes("/api/question/")) return;
  rep.api.push({ url: r.url().replace(BASE, ""), status: r.status(), provider: r.headers()["x-provider"], cache: r.headers()["x-cache"] });
});
const clickText = (text) => page.evaluate((text) => {
  const el = [...document.querySelectorAll("button, summary")].find((b) => b.textContent?.trim().includes(text) && !b.disabled);
  if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true;
}, text);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const waitFor = async (fn, ms, arg) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 300 }, arg); return true; } catch { return false; } };

try {
  await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
  await waitFor(() => !document.body.innerText.includes("불러오는 중") || document.querySelectorAll("textarea").length > 0, 20000);
  await sleep(1000);
  step("loaded", { overflow: await overflow() });
  await shot(page, `${OUT}/01-loaded.png`);

  let started = false;
  if (scen === "generate") {
    const t0 = Date.now();
    step("click generate", { ok: await clickText("질문 생성") });
    await waitFor(() => !!document.querySelector('[data-testid="start-qa"]') || (!!document.querySelector('[data-testid="gen-errors"]') && !document.body.innerText.includes("질문 생성 중")), 150000);
    await sleep(800);
    const st = await page.evaluate(() => ({
      errors: [...document.querySelectorAll('[data-testid="gen-errors"] p')].map((p) => p.textContent),
      judges: [...document.querySelectorAll('[data-testid="judge-questions"]')].map((d) => d.innerText.slice(0, 300)),
      startQa: !!document.querySelector('[data-testid="start-qa"]'),
      provider: document.querySelector('[data-testid="provider"]')?.textContent,
    }));
    step("generate finished", { ms: Date.now() - t0, ...st });
    await shot(page, `${OUT}/02-generated.png`);
    await shot(page, `${OUT}/02-generated-full.png`, { fullPage: true });
    if (!st.startQa && st.errors.length) {
      step("replay-latest from error card", { ok: await page.evaluate(() => { const b = document.querySelector('[data-testid="replay-latest"]'); b?.click(); return !!b; }) });
      await waitFor(() => !!document.querySelector('[data-testid="start-qa"]'), 15000);
      await shot(page, `${OUT}/02b-replayed.png`);
    }
  } else {
    const runs = await (await fetch(`${BASE}/api/question/runs`)).json();
    const pick = runs.runs.find((r) => r.questions >= 6) ?? runs.runs[0];
    step("open replay", { ok: await clickText("저장된 실행 불러오기"), pick: pick.id, qaBefore: pick.qa });
    await waitFor(() => document.querySelectorAll("#replay-run option").length > 1, 10000);
    await page.select("#replay-run", pick.id);
    step("replay load", { ok: await page.evaluate(() => { const b = document.querySelector('[data-testid="replay-load"]'); b?.click(); return !!b; }) });
    await waitFor(() => !!document.querySelector('[data-testid="start-qa"]'), 15000);
    await sleep(800);
    await shot(page, `${OUT}/02-replayed.png`);
  }

  // evidence expand + context inspector
  const ev = await page.evaluate(() => {
    const d = [...document.querySelectorAll("details")].find((x) => x.querySelector("summary")?.textContent?.includes("근거"));
    if (d) { d.open = true; d.scrollIntoView({ block: "center" }); }
    return d ? d.innerText.slice(0, 500) : null;
  });
  step("evidence expanded", { ev });
  await sleep(400);
  await shot(page, `${OUT}/03-evidence.png`);
  const insp = await page.evaluate(() => {
    const d = [...document.querySelectorAll("details")].find((x) => x.querySelector("summary")?.textContent?.includes("위키 질의"));
    if (d) { d.open = true; d.scrollIntoView({ block: "start" }); }
    return d ? d.innerText.slice(0, 400) : null;
  });
  step("inspector", { insp });
  await sleep(400);
  await shot(page, `${OUT}/04-inspector.png`);

  // Q&A
  if (await page.$('[data-testid="start-qa"]')) {
    await page.evaluate(() => document.querySelector('[data-testid="start-qa"]').click());
    started = true;
    await sleep(1500);
    const geo = await page.evaluate(() => ({ stageTop: document.querySelector('[data-testid="qa-stage"]')?.getBoundingClientRect().top, q: document.querySelector('[data-testid="current-question"]')?.textContent }));
    step("qa started", geo);
    await waitFor(() => !!document.querySelector('[data-testid="tts-info"]') || /음성|TTS|텍스트로 진행/.test(document.querySelector('[data-testid="qa-stage"]')?.innerText ?? ""), 30000);
    await sleep(500);
    step("tts state", { stage: await page.evaluate(() => document.querySelector('[data-testid="qa-stage"]')?.innerText.slice(0, 600)) });
    await shot(page, `${OUT}/05-qa.png`);

    const answer = async (text, label) => {
      await page.click('textarea[aria-label="답변"]');
      await page.keyboard.type(text, { delay: 0 });
      const t0 = Date.now();
      await clickText("답변 완료");
      await waitFor(() => !document.body.innerText.includes("심사위원이 답변을 검토 중"), 90000);
      await sleep(800);
      const r = await page.evaluate(() => ({ last: document.querySelector('[data-testid="last-assessment"]')?.textContent, cur: document.querySelector('[data-testid="current-question"]')?.textContent, err: [...document.querySelectorAll(".text-error")].map((e) => e.textContent).filter(Boolean).slice(0, 3), finished: document.body.innerText.includes("질의응답이 끝났습니다") }));
      step(`answer ${label}`, { ms: Date.now() - t0, ...r });
      await shot(page, `${OUT}/06-${label}.png`);
      return r;
    };
    await answer("아 그게… 기준이 좀 달라서요. 아마 초기 수치가 들어간 것 같습니다.", "weak");
    await answer("현재 양산 기준 원가는 세트당 142원이 맞고, 매출총이익률은 약 14%입니다. 덱의 118원과 28%는 2공장 가동 전 목표치를 잘못 기재한 것이며, SOM도 제안서의 210억 원(SAM의 3.1%)이 최종입니다. 오늘 정정본을 드리겠습니다.", "strong");
    if (await page.$('[data-testid="save-session"]')) {
      await page.evaluate(() => document.querySelector('[data-testid="save-session"]').click());
      await waitFor(() => !!document.querySelector('[data-testid="saved"]'), 15000);
      const saved = await page.evaluate(() => document.querySelector('[data-testid="saved"]')?.textContent);
      step("saved", { saved });
      await page.evaluate(() => document.querySelector('[data-testid="saved"]')?.scrollIntoView({ block: "center" }));
      await sleep(300);
      await shot(page, `${OUT}/07-saved.png`);
    }
  }
  step("final", { overflow: await overflow(), started });
} catch (e) {
  step("EXCEPTION", { msg: String(e?.stack ?? e).slice(0, 500) });
  await shot(page, `${OUT}/99-exception.png`).catch(() => {});
} finally {
  rep.consoleErrors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  rep.logsTail = logs.slice(-15);
  writeFileSync(`${OUT}/report.json`, JSON.stringify(rep, null, 2));
  console.log("console errors:", rep.consoleErrors.length, rep.consoleErrors.slice(0, 5));
  console.log("api:", JSON.stringify(rep.api));
  await browser.close();
}
