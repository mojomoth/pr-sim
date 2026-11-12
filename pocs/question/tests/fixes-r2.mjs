#!/usr/bin/env node
// Round-2 fix verification in headless Chrome (real APIs).
// usage: node question/tests/fixes-r2.mjs replay  [runId]   — replayed run with old QA history: evasive answer → 꼬리질문, twice (2 fresh sessions)
//        node question/tests/fixes-r2.mjs retry   <runId>   — partial run: "실패한 심사위원 다시 생성" → every judge has questions
//        node question/tests/fixes-r2.mjs silent  [runId]   — mic with a silent fake input: "인식된 음성이 없습니다" hint, empty answer is not submitted
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const scen = process.argv[2] ?? "replay";
const runId = process.argv[3] ?? "r_mwdn4vohkd6v2";
const mobile = scen !== "replay";
const OUT = `.verify/question/fixes-r2/${scen}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launch({ mobile, fakeAudioWav: scen === "silent" ? path.resolve("question/tests/silence-16k.wav") : undefined });
const rep = { scen, runId, mobile, steps: [], api: [] };
let fail = 0;
const step = (name, extra = {}) => { rep.steps.push({ name, ...extra }); console.log("-", name, JSON.stringify(extra).slice(0, 500)); };
const check = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"} ${msg}`); rep.steps.push({ pass: !!c, msg }); if (!c) fail++; };
page.on("response", (r) => { if (r.url().includes("/api/question/") && r.request().method() === "POST") rep.api.push({ url: r.url().replace(BASE, ""), status: r.status() }); });
const waitFor = async (fn, ms, arg) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 300 }, arg); return true; } catch { return false; } };
const clickText = (text) => page.evaluate((text) => {
  const el = [...document.querySelectorAll("button, summary")].find((b) => b.textContent?.trim().includes(text) && !b.disabled);
  if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true;
}, text);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function loadRun(id) {
  if (!(await page.evaluate(() => document.querySelector('[data-testid="replay"]')?.open))) await clickText("저장된 실행 불러오기");
  await waitFor((id) => [...document.querySelectorAll("#replay-run option")].some((o) => o.value === id), 15000, id);
  await page.select("#replay-run", id);
  await page.evaluate(() => document.querySelector('[data-testid="replay-load"]').click());
  await waitFor(() => !!document.querySelector('[data-testid="start-qa"]') || !!document.querySelector('[data-testid="retry-failed"]'), 15000);
  await sleep(600);
}
async function startQa() {
  await page.evaluate(() => document.querySelector('[data-testid="start-qa"]').click());
  await waitFor(() => !!document.querySelector('[data-testid="qa-stage"]'), 10000);
  await sleep(800);
}
async function typeAnswer(text, label) {
  await page.click('textarea[aria-label="답변"]');
  await page.keyboard.type(text, { delay: 0 });
  const t0 = Date.now();
  await clickText("답변 완료");
  await sleep(300);
  await waitFor(() => !document.body.innerText.includes("심사위원이 답변을 검토 중"), 90000);
  await sleep(800);
  const r = await page.evaluate(() => ({ last: document.querySelector('[data-testid="last-assessment"]')?.textContent, cur: document.querySelector('[data-testid="current-question"]')?.textContent, attempt: [...document.querySelectorAll("code")].map((c) => c.textContent).find((t) => /^a_/.test(t ?? "")) }));
  step(`answer ${label}`, { ms: Date.now() - t0, ...r });
  await shot(page, `${OUT}/${label}.png`);
  return r;
}

try {
  await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
  await waitFor(() => document.querySelectorAll("textarea").length > 0, 20000);
  await sleep(800);

  if (scen === "replay") {
    const before = await (await fetch(`${BASE}/api/question/runs/${runId}`)).text();
    const EVASIVE = "아 그게… 기준이 좀 달라서요. 아마 초기 수치가 들어간 것 같습니다.";
    const decisions = [];
    for (const n of [1, 2]) {
      await loadRun(runId);
      await shot(page, `${OUT}/0${n}-loaded.png`);
      await startQa();
      // voice off is not needed: typing stops nothing; the evasive answer goes to the first (main) question
      const r = await typeAnswer(EVASIVE, `0${n}-evasive-session${n}`);
      decisions.push(r);
      check(/꼬리질문/.test(r.last ?? ""), `session ${n} (attempt ${r.attempt}): evasive answer → ${r.last?.match(/(충분|부분|회피|부정확) \d\/5 · [^·]+/)?.[0]}`);
    }
    check(decisions[0].attempt !== decisions[1].attempt, `each Q&A start gets its own attempt (${decisions.map((d) => d.attempt).join(" / ")})`);
    const after = await (await fetch(`${BASE}/api/question/runs/${runId}`)).text();
    check(before === after, "saved run unchanged by the two replays");
  } else if (scen === "retry") {
    await loadRun(runId);
    const st = await page.evaluate(() => ({ card: document.querySelector('[data-testid="gen-errors"]')?.innerText, btn: document.querySelector('[data-testid="retry-failed"]')?.textContent }));
    step("partial run loaded", st);
    check(!!st.btn, `retry button shown: ${st.btn}`);
    await page.evaluate(() => document.querySelector('[data-testid="gen-errors"]')?.scrollIntoView({ block: "start" }));
    await shot(page, `${OUT}/01-partial.png`);
    const t0 = Date.now();
    await page.evaluate(() => document.querySelector('[data-testid="retry-failed"]').click());
    await sleep(500);
    await waitFor(() => !document.querySelector('[data-testid="retry-failed"]') || !document.body.innerText.includes("다시 생성 중"), 120000);
    await sleep(1000);
    const after = await page.evaluate(() => ({
      card: document.querySelector('[data-testid="gen-errors"]')?.innerText ?? null,
      judges: [...document.querySelectorAll('[data-testid="judge-questions"]')].map((d) => d.innerText.split("\n").slice(0, 3).join(" | ")),
      startQa: !!document.querySelector('[data-testid="start-qa"]'),
    }));
    step("after retry", { ms: Date.now() - t0, ...after });
    const run = await (await fetch(`${BASE}/api/question/runs`)).json();
    const s = run.runs.find((r) => r.id === runId);
    check(s?.complete, `run complete after retry: questions=${s?.questions} failed=${JSON.stringify(s?.failedJudges)}`);
    check(!after.card, "error card gone");
    await page.evaluate(() => document.querySelector('[data-testid="judge-questions"]')?.scrollIntoView({ block: "start" }));
    await shot(page, `${OUT}/02-retried.png`);
    await shot(page, `${OUT}/02-retried-full.png`, { fullPage: true });
  } else if (scen === "silent") {
    await loadRun(runId);
    // voice off so the test does not wait for TTS
    await page.evaluate(() => { const c = [...document.querySelectorAll("label")].find((l) => /자동 음성|음성으로 질문|음성 재생/.test(l.textContent ?? ""))?.querySelector("input"); if (c && c.checked) c.click(); });
    await startQa();
    await page.click('button[aria-label="마이크로 답변"]');
    const shown = await waitFor(() => !!document.querySelector('[data-testid="mic-silent"]'), 20000);
    const hint = await page.evaluate(() => document.querySelector('[data-testid="mic-silent"]')?.textContent);
    check(shown, `no-speech hint shown: ${hint}`);
    await page.evaluate(() => document.querySelector('[data-testid="mic-silent"]')?.scrollIntoView({ block: "center" }));
    await shot(page, `${OUT}/01-mic-silent.png`);
    const nBefore = rep.api.filter((a) => a.url.includes("followup")).length;
    await clickText("답변 완료");
    await sleep(2500);
    const err = await page.evaluate(() => [...document.querySelectorAll('[data-testid="qa-stage"] .text-error')].map((e) => e.textContent));
    const nAfter = rep.api.filter((a) => a.url.includes("followup")).length;
    check(err.some((e) => e?.includes("음성이 인식되지 않았습니다")), `empty mic answer blocked: ${err.join(" / ")}`);
    check(nAfter === nBefore, `no followup request sent for the empty answer (${nAfter - nBefore})`);
    await shot(page, `${OUT}/02-empty-blocked.png`);
  }
  step("overflow", { px: await overflow() });
} catch (e) {
  step("ERROR", { e: String(e?.stack ?? e) });
  fail++;
} finally {
  rep.consoleErrors = logs.filter((l) => /\[error\]|pageerror/.test(l) && !/favicon/.test(l));
  check(rep.consoleErrors.length === 0, `console errors: ${rep.consoleErrors.length} ${rep.consoleErrors.slice(0, 3).join(" | ")}`);
  writeFileSync(`${OUT}/report.json`, JSON.stringify(rep, null, 2));
  await browser.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
}
