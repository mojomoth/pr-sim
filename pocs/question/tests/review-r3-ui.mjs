#!/usr/bin/env node
// Review round 3 E2E (independent reviewer). Real APIs, no mocks.
// usage: node question/tests/review-r3-ui.mjs <mobile|desktop>
import { writeFileSync, mkdirSync } from "node:fs";
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const mode = process.argv[2] === "desktop" ? "desktop" : "mobile";
const OUT = `.verify/question/review/r3-${mode}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launch({ mobile: mode === "mobile" });
const rep = { mode, steps: [], api: [] };
const step = (name, extra = {}) => { rep.steps.push({ name, ...extra }); console.log("-", name, JSON.stringify(extra).slice(0, 600)); };
page.on("response", (r) => { if (r.url().includes("/api/question/")) rep.api.push({ url: r.url().replace(BASE, ""), status: r.status(), provider: r.headers()["x-provider"] }); });
const clickText = (text) => page.evaluate((text) => { const el = [...document.querySelectorAll("button, summary")].find((b) => b.textContent?.trim().includes(text) && !b.disabled); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; }, text);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const waitFor = async (fn, ms, arg) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 300 }, arg); return true; } catch { return false; } };
try {
  await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
  await waitFor(() => document.querySelectorAll("textarea").length > 0, 20000);
  await sleep(1000);
  step("loaded", { overflow: await overflow(), text: (await page.evaluate(() => document.body.innerText)).slice(0, 300) });
  await shot(page, `${OUT}/01-loaded.png`);
  await shot(page, `${OUT}/01-loaded-full.png`, { fullPage: true });
  // generate (providers expected down) → error card
  const t0 = Date.now();
  step("click generate", { ok: await clickText("질문 생성") });
  await waitFor(() => !!document.querySelector('[data-testid="start-qa"]') || (!!document.querySelector('[data-testid="gen-errors"]') && !document.body.innerText.includes("질문 생성 중")), 150000);
  await sleep(800);
  step("generate finished", { ms: Date.now() - t0, errors: await page.evaluate(() => [...document.querySelectorAll('[data-testid="gen-errors"] p')].map((p) => p.textContent)), overflow: await overflow() });
  await shot(page, `${OUT}/02-generate-error.png`);
  // replay latest
  step("replay-latest", { ok: await page.evaluate(() => { const b = document.querySelector('[data-testid="replay-latest"]'); b?.click(); return !!b; }) });
  await waitFor(() => !!document.querySelector('[data-testid="start-qa"]'), 15000);
  await sleep(800);
  await shot(page, `${OUT}/03-replayed.png`);
  await shot(page, `${OUT}/03-replayed-full.png`, { fullPage: true });
  const ev = await page.evaluate(() => { const d = [...document.querySelectorAll("details")].find((x) => x.querySelector("summary")?.textContent?.includes("근거")); if (d) { d.open = true; d.scrollIntoView({ block: "center" }); } return d ? d.innerText.slice(0, 500) : null; });
  step("evidence", { ev });
  await sleep(300); await shot(page, `${OUT}/04-evidence.png`);
  const insp = await page.evaluate(() => { const d = [...document.querySelectorAll("details")].find((x) => x.querySelector("summary")?.textContent?.includes("위키 질의")); if (d) { d.open = true; d.scrollIntoView({ block: "start" }); } return d ? d.innerText.slice(0, 600) : null; });
  step("inspector", { insp });
  await sleep(300); await shot(page, `${OUT}/05-inspector.png`);
  // QA
  await page.evaluate(() => document.querySelector('[data-testid="start-qa"]').click());
  await sleep(1500);
  await waitFor(() => !!document.querySelector('[data-testid="tts-info"]') || /음성 재생 실패/.test(document.querySelector('[data-testid="qa-stage"]')?.innerText ?? ""), 40000);
  step("qa tts", { stage: await page.evaluate(() => document.querySelector('[data-testid="qa-stage"]')?.innerText.slice(0, 500)) });
  await shot(page, `${OUT}/06-qa.png`);
  const q1 = await page.evaluate(() => document.querySelector('[data-testid="current-question"]')?.textContent);
  await page.click('textarea[aria-label="답변"]');
  await page.keyboard.type("아 그게… 기준이 좀 달라서요. 리뷰어 답변 A.", { delay: 0 });
  const ta = Date.now();
  await clickText("답변 완료");
  await waitFor(() => !document.body.innerText.includes("심사위원이 답변을 검토 중"), 90000);
  await sleep(800);
  const afterA = await page.evaluate(() => ({ cur: document.querySelector('[data-testid="current-question"]')?.textContent, errs: [...document.querySelectorAll('[data-testid="qa-stage"] .text-error')].map((e) => e.textContent), answerBox: document.querySelector('textarea[aria-label="답변"]')?.value, last: document.querySelector('[data-testid="last-assessment"]')?.textContent }));
  step("answer A (followup)", { ms: Date.now() - ta, q1, ...afterA });
  await shot(page, `${OUT}/07-answerA.png`);
  // skip → next
  await clickText("건너뛰기");
  await sleep(1500);
  step("skip", { cur: await page.evaluate(() => document.querySelector('[data-testid="current-question"]')?.textContent), finished: await page.evaluate(() => document.body.innerText.includes("질의응답이 끝났습니다")) });
  await shot(page, `${OUT}/08-skipped.png`);
  // save session
  const sv = await page.$('[data-testid="save-session"]');
  if (sv) {
    await page.evaluate(() => { const b = document.querySelector('[data-testid="save-session"]'); b.scrollIntoView({ block: "center" }); b.click(); });
    await waitFor(() => !!document.querySelector('[data-testid="saved"]'), 15000);
    const saved = await page.evaluate(() => document.querySelector('[data-testid="saved"]')?.textContent);
    step("saved", { saved });
    await sleep(300); await shot(page, `${OUT}/09-saved.png`);
  } else step("no save button visible");
} catch (e) { step("EXCEPTION", { e: String(e) }); await shot(page, `${OUT}/zz-exception.png`); }
rep.logs = logs; rep.overflowEnd = await overflow();
writeFileSync(`${OUT}/report.json`, JSON.stringify(rep, null, 1));
console.log("console:", logs.filter((l) => /error|pageerror|requestfailed/i.test(l)).slice(0, 15));
console.log("api:", rep.api.map((a) => `${a.status} ${a.url}`).join("\n"));
await browser.close();
