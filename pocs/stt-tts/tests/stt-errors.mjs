// Error-path checks: mic permission denied, token failure (auto → B fallback), API error surfaced in UI.
import { launch, shot, BASE } from "./launch.mjs";
import { writeFileSync } from "node:fs";
import path from "node:path";
const out = {};
// 1) mic denied
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.evaluateOnNewDocument(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await page.goto(`${BASE}/stt-tts`, { waitUntil: "networkidle0" });
  await page.click("[data-testid=stt-start]");
  await page.waitForSelector("[data-testid=stt-error]", { timeout: 10000 });
  out.micDenied = { error: await page.$eval("[data-testid=stt-error]", (e) => e.textContent), status: await page.$eval("[data-testid=stt-status]", (e) => e.textContent) };
  await page.evaluate(() => document.querySelector("[data-testid=stt-error]")?.scrollIntoView({ block: "center" }));
  await shot(page, ".verify/stt-tts/err-mic-denied.png");
  out.micDeniedConsole = logs.filter((l) => /pageerror/.test(l));
  await browser.close();
}
// 2) token endpoint fails → auto mode falls back to VAD+전사; transcribe errors (e.g. quota) shown as notice
for (const mode of ["auto", "live"]) {
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: path.resolve("stt-tts/tests/fixtures/pitch-ko-16k.wav") });
  await page.setRequestInterception(true);
  page.on("request", (r) => r.url().includes("/api/stt-tts/token")
    ? r.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "테스트: 토큰 발급 실패" }) })
    : r.continue());
  await page.goto(`${BASE}/stt-tts`, { waitUntil: "networkidle0" });
  if (mode === "live") await page.click('[role=radiogroup][aria-label="전사 방식"] button:nth-child(2)');
  await page.click("[data-testid=stt-start]");
  await new Promise((r) => setTimeout(r, mode === "auto" ? 12000 : 3000));
  const r = {
    status: await page.$eval("[data-testid=stt-status]", (e) => e.textContent),
    engine: await page.$eval("[data-testid=stt-engine]", (e) => e.textContent).catch(() => null),
    notice: await page.$eval("[data-testid=stt-notice]", (e) => e.textContent).catch(() => null),
    error: await page.$eval("[data-testid=stt-error]", (e) => e.textContent).catch(() => null),
    sentences: await page.$$eval("[data-testid=sentence][data-status=final]", (els) => els.map((e) => e.innerText.replace(/\n/g, " | "))),
  };
  await shot(page, `.verify/stt-tts/err-token-${mode}.png`);
  if (await page.$("[data-testid=stt-stop]")) await page.click("[data-testid=stt-stop]");
  r.pageErrors = logs.filter((l) => /pageerror/.test(l));
  out[`tokenFail_${mode}`] = r;
  await browser.close();
}
writeFileSync(".verify/stt-tts/stt-errors.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
