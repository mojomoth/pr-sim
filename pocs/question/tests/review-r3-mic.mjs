// Review r3: answer by voice (fake mic WAV → stt-tts Live STT) on a replayed run, mobile.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/question/review/r3-mic"; mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: path.resolve("fixtures/audio/answer-ko-16k.wav") });
const waitFor = async (fn, ms) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 300 }); return true; } catch { return false; } };
const rep = {};
try {
  await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
  await waitFor(() => document.querySelectorAll("textarea").length > 0, 20000);
  await page.evaluate(() => { const d = document.querySelector('[data-testid="replay"]'); d.open = true; d.dispatchEvent(new Event("toggle")); });
  await waitFor(() => document.querySelectorAll("#replay-run option").length > 1, 10000);
  await sleep(800);
  await page.evaluate(() => document.querySelector('[data-testid="replay-load"]').click());
  await waitFor(() => !!document.querySelector('[data-testid="start-qa"]'), 15000);
  await page.evaluate(() => { const c = [...document.querySelectorAll('input[type=checkbox]')].find((x) => x.parentElement?.textContent.includes("음성으로 질문")); if (c?.checked) c.click(); });
  await page.evaluate(() => document.querySelector('[data-testid="start-qa"]').click());
  await sleep(1200);
  await page.click('button[aria-label="마이크로 답변"]');
  const t0 = Date.now();
  const got = await waitFor(() => (document.querySelector('textarea[aria-label="답변"]')?.value ?? "").length > 15, 40000);
  rep.transcribed = got; rep.ms = Date.now() - t0;
  await sleep(6000);
  rep.text = await page.evaluate(() => document.querySelector('textarea[aria-label="답변"]')?.value);
  await shot(page, `${OUT}/01-listening.png`);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("답변 완료"))?.click());
  await waitFor(() => !document.body.innerText.includes("심사위원이 답변을 검토 중"), 90000);
  await sleep(800);
  rep.after = await page.evaluate(() => ({ last: document.querySelector('[data-testid="last-assessment"]')?.textContent, cur: document.querySelector('[data-testid="current-question"]')?.textContent, errs: [...document.querySelectorAll('[data-testid="qa-stage"] .text-error')].map((e) => e.textContent), log: [...document.querySelectorAll('[data-testid="qa-log-item"]')].map((e) => e.innerText.slice(0, 200)) }));
  await shot(page, `${OUT}/02-after.png`);
} catch (e) { rep.exception = String(e); }
rep.logs = logs.filter((l) => /error|pageerror|failed/i.test(l));
writeFileSync(`${OUT}/report.json`, JSON.stringify(rep, null, 1)); console.log(JSON.stringify(rep, null, 1));
await browser.close();
