// Reviewer test: fake mic WAV → /stt-tts, poll bubbles, record timeline + DOM text.
// usage: WAV=... TAG=... MOBILE=1 SHARED=1 node stt-tts/tests/review-stt.mjs <auto|live|chunked> <secs>
import { launch as launchLocal, shot, BASE } from "./launch.mjs";
import { launch as launchShared } from "../../scripts/browser.mjs";
import { writeFileSync } from "node:fs";
import path from "node:path";
const mode = process.argv[2] ?? "auto";
const secs = Number(process.argv[3] ?? 60);
const wav = path.resolve(process.env.WAV ?? "fixtures/audio/speech-ko-16k.wav");
const tag = process.env.TAG ?? mode;
const mobile = process.env.MOBILE !== "0";
const launch = process.env.SHARED ? launchShared : launchLocal;
const { browser, page, logs } = await launch({ mobile, fakeAudioWav: wav });
const out = { mode, wav, mobile };
const dir = ".verify/stt-tts/review";
try {
  await page.goto(`${BASE}/stt-tts`, { waitUntil: "networkidle0" });
  if (mode !== "auto") await page.click(`[role=radiogroup][aria-label="전사 방식"] button:nth-child(${mode === "live" ? 2 : 3})`);
  const t0 = Date.now();
  await page.click("[data-testid=stt-start]");
  const timeline = [];
  let prev = "";
  let partialShot = 0;
  while (Date.now() - t0 < secs * 1000) {
    await new Promise((r) => setTimeout(r, 200));
    const snap = await page.$$eval("[data-testid=sentence]", (els) => els.map((e) => ({ s: e.getAttribute("data-status"), t: e.innerText.replace(/\n/g, " | ") })));
    const key = JSON.stringify(snap);
    if (key !== prev) { timeline.push({ at: +((Date.now() - t0) / 1000).toFixed(1), finals: snap.filter((x) => x.s === "final").length, partial: snap.filter((x) => x.s === "partial").map((x) => x.t) }); prev = key; }
    if (partialShot < 2 && snap.some((x) => x.s === "partial" && x.t.length > 20) && Date.now() - t0 > (partialShot ? 25000 : 8000)) { await shot(page, `${dir}/${tag}-partial${partialShot}.png`); partialShot++; }
  }
  out.notice = await page.$eval("[data-testid=stt-notice]", (e) => e.textContent).catch(() => null);
  out.error = await page.$eval("[data-testid=stt-error]", (e) => e.textContent).catch(() => null);
  out.engine = await page.$eval("[data-testid=stt-engine]", (e) => e.textContent).catch(() => null);
  await shot(page, `${dir}/${tag}-running.png`);
  const ts = Date.now();
  await page.click("[data-testid=stt-stop]").catch(() => {});
  await page.waitForFunction(() => !document.querySelector("[data-testid=stt-stop]"), { timeout: 25000 }).catch(() => (out.stopTimeout = true));
  out.stopMs = Date.now() - ts;
  out.sentences = await page.$$eval("[data-testid=sentence]", (els) => els.map((e) => `${e.getAttribute("data-status")}: ${e.innerText.replace(/\n/g, " | ")}`));
  out.metrics = await page.$eval("[data-testid=stt-metrics]", (e) => e.textContent).catch(() => null);
  out.timeline = timeline;
  await shot(page, `${dir}/${tag}-done.png`, { fullPage: true });
} finally {
  out.logs = logs.filter((l) => !/\[(log|debug|info)\]/.test(l) || /error/i.test(l));
  writeFileSync(`${dir}/${tag}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, timeline: out.timeline?.length }, null, 2));
  await browser.close();
}
