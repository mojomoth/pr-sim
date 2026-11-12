// Reviewer: TTS UI (cached persona compare) + STT error paths (mic denied, token 500 in live/auto)
import { launch, shot, BASE } from "./launch.mjs";
import { writeFileSync } from "node:fs";
const dir = ".verify/stt-tts/review";
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --- TTS UI
{
  const { browser, page, logs } = await launch({ mobile: true });
  try {
    await page.goto(`${BASE}/stt-tts`, { waitUntil: "networkidle0" });
    const voice0 = await page.$eval("[data-testid=tts-voice]", (e) => e.textContent);
    await page.click('[role=radiogroup][aria-label="성별"] button:nth-child(2)');
    await page.$eval("#tts-age", (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, "27"); el.dispatchEvent(new Event("input", { bubbles: true })); });
    await sleep(200);
    const voices = {};
    for (const [i, t] of ["friendly", "strict", "aggressive"].entries()) {
      await page.click(`[role=radiogroup][aria-label="성향"] button:nth-child(${i + 1})`);
      await sleep(150);
      voices[t] = { voice: await page.$eval("[data-testid=tts-voice]", (e) => e.textContent), text: await page.$eval("#tts-text", (e) => e.value) };
    }
    out.ttsVoices = { voice0, ...voices, age: await page.$eval("[data-testid=tts-age]", (e) => e.textContent) };
    // set text to the one cached by reviewer curl calls
    await page.click("#tts-text", { clickCount: 3 });
    await page.$eval("#tts-text", (el) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.type("#tts-text", "안녕하세요 리뷰 테스트 문장입니다");
    const t0 = Date.now();
    await page.click("[data-testid=tts-compare]");
    const prog = new Set();
    while (Date.now() - t0 < 25000) {
      const p = await page.$eval("[data-testid=tts-progress]", (e) => e.textContent).catch(() => null);
      if (p) prog.add(p);
      if (Date.now() - t0 > 1500 && !p) break;
      await sleep(150);
    }
    out.compareMs = Date.now() - t0;
    out.compareProgress = [...prog];
    out.clips = await page.$$eval("[data-testid=tts-clip]", (els) => els.map((e) => e.innerText.replace(/\n/g, " | ")));
    out.ttsError = await page.$eval("[data-testid=tts-error]", (e) => e.textContent).catch(() => null);
    await shot(page, `${dir}/tts-mobile-compare.png`, { fullPage: true });
    // empty text → buttons disabled
    await page.$eval("#tts-text", (el) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(el, "   "); el.dispatchEvent(new Event("input", { bubbles: true })); });
    await sleep(100);
    out.emptyDisabled = await page.$eval("[data-testid=tts-generate]", (e) => e.disabled);
    // server error path: force 429 via interception
    await page.setRequestInterception(true);
    page.on("request", (r) => r.url().includes("/api/stt-tts/tts") ? r.respond({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Gemini 무료 사용량 한도(분당 요청 수)를 초과했습니다. 잠시 후 다시 시도해 주세요.", retryAfterSec: 20 }) }) : r.continue());
    await page.$eval("#tts-text", (el) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(el, "새로운 문장"); el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click("[data-testid=tts-generate]");
    await sleep(800);
    out.tts429 = await page.$eval("[data-testid=tts-error]", (e) => e.textContent).catch(() => null);
    out.ttsLogs = logs.filter((l) => /error|pageerror|requestfailed/i.test(l));
  } finally { await browser.close(); }
}
// --- STT mic denied
{
  const { browser, page } = await launch({ mobile: true });
  try {
    await page.evaluateOnNewDocument(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError")); });
    await page.goto(`${BASE}/stt-tts`, { waitUntil: "networkidle0" });
    await page.click("[data-testid=stt-start]");
    await sleep(1000);
    out.micDenied = { error: await page.$eval("[data-testid=stt-error]", (e) => e.textContent).catch(() => null), status: await page.$eval("[data-testid=stt-status]", (e) => e.textContent), startVisible: !!(await page.$("[data-testid=stt-start]")) };
    await shot(page, `${dir}/err-mic-denied.png`);
  } finally { await browser.close(); }
}
// --- token 500 in live & auto
for (const mode of ["live", "auto"]) {
  const { browser, page } = await launch({ mobile: true });
  try {
    await page.setRequestInterception(true);
    page.on("request", (r) => r.url().includes("/api/stt-tts/token") ? r.respond({ status: 500, contentType: "application/json", body: '{"error":"테스트 토큰 오류"}' }) : r.continue());
    await page.goto(`${BASE}/stt-tts`, { waitUntil: "networkidle0" });
    if (mode === "live") await page.click('[role=radiogroup][aria-label="전사 방식"] button:nth-child(2)');
    await page.click("[data-testid=stt-start]");
    await sleep(2000);
    out[`token500_${mode}`] = { error: await page.$eval("[data-testid=stt-error]", (e) => e.textContent).catch(() => null), notice: await page.$eval("[data-testid=stt-notice]", (e) => e.textContent).catch(() => null), status: await page.$eval("[data-testid=stt-status]", (e) => e.textContent), engine: await page.$eval("[data-testid=stt-engine]", (e) => e.textContent).catch(() => null) };
    await shot(page, `${dir}/err-token-${mode}.png`);
  } finally { await browser.close(); }
}
writeFileSync(`${dir}/ui.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
