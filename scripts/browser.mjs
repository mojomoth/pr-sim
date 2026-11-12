// Headless Chrome helper for autonomous verification (each agent gets its OWN browser).
// import { launch, shot } from "./browser.mjs"
//   const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: "/abs/file.wav" })
//   await page.goto("http://localhost:3100/slide"); await shot(page, ".verify/slide.png")
// fakeAudioWav: a WAV file Chrome will use as the microphone (needs --use-fake-device-for-media-stream).
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export const BASE = process.env.POC_BASE ?? "http://localhost:3100";
export const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export async function launch({ mobile = false, fakeAudioWav, headless = true } = {}) {
  const args = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check",
  ];
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
export async function shot(page, path, opts = {}) {
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: opts.fullPage ?? false });
  return path;
}
