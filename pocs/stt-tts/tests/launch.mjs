// Same as scripts/browser.mjs launch(), plus --disable-features=AudioServiceSandbox:
// on macOS the sandboxed audio service cannot read the --use-file-for-fake-audio-capture WAV and
// the fake mic is silent (verified: peak 0 → 0.55 with the flag). See stt-tts/tests/micprobe.mjs.
import puppeteer from "puppeteer-core";
import { CHROME } from "../../scripts/browser.mjs";
export { BASE, shot } from "../../scripts/browser.mjs";
export async function launch({ mobile = false, fakeAudioWav, headless = true, extraArgs = [] } = {}) {
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check", "--disable-features=AudioServiceSandbox", ...extraArgs];
  if (fakeAudioWav) args.push(`--use-file-for-fake-audio-capture=${fakeAudioWav}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless, args });
  const page = await browser.newPage();
  if (mobile) await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: 1280, height: 860 });
  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  return { browser, page, logs };
}
