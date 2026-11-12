// Mount the CORE React pieces (SlideViewer + camera overlay, useCountdown, useSentenceTranscriber,
// useCamera, useBlobUrl) with real React inside http://localhost:3000/ — 390×844 mobile viewport,
// fake camera + fake mic (fixture speech). Writes react-results.json + screenshots.
import { readFileSync, writeFileSync } from "node:fs";
import { shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { launchCore } from "./harness.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g2/CORE";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launchCore({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/speech-ko-16k.wav" });

try {
  const judge = readFileSync("/Users/jyl/work/study/pr-sim/pocs/.data/judge/j_mwdja1fzc0gw5.webp").toString("base64");
  await page.evaluate(async (b) => (await import("/__test/react-test.tsx.src")).mount(b), judge);
  await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[data-page-host="1"]')?.getAttribute("data-render-state") === "done", { timeout: 20000 });
  await sleep(800);
  let s = await page.evaluate(() => ({ pages: window.T.pages, cam: window.T.cam, blobUrl: window.T.blobUrl, indicator: document.querySelector("[data-page-indicator]")?.textContent }));
  check("slide: loads sample PDF from Blob, 1 / 12", s.indicator === "1 / 12" && s.pages[0] === "1/12", s);
  check("camera: useCamera live (fake camera) in slide overlay", s.cam === "live", s.cam);
  check("db: useBlobUrl gives an object URL", /^blob:/.test(s.blobUrl ?? ""), s.blobUrl);
  await shot(page, `${OUT}/react-slide-mobile.png`);

  await page.click('[data-action="next"]');
  await sleep(500);
  // mouse drag swipe left → next page
  const box = await (await page.$("[data-slide-viewport]")).boundingBox();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.75 - i * 0.06), box.y + box.height / 2, { steps: 2 });
  await page.mouse.up();
  await sleep(600);
  s = await page.evaluate(() => ({ pages: window.T.pages, indicator: document.querySelector("[data-page-indicator]")?.textContent }));
  check("slide: next button + drag swipe → 3 / 12, onPageChange fired", s.indicator === "3 / 12" && s.pages.at(-1) === "3/12", s);

  // keyboard (viewer focused after interaction) → ArrowLeft
  await page.keyboard.press("ArrowLeft");
  await sleep(400);
  s = await page.evaluate(() => document.querySelector("[data-page-indicator]")?.textContent);
  check("slide: keyboard ArrowLeft → 2 / 12", s === "2 / 12", s);

  // countdown pause/resume
  const c0 = await page.evaluate(() => window.T.countdown);
  await page.evaluate(() => window.T.setRunning(false));
  await sleep(1200);
  const c1 = await page.evaluate(() => window.T.countdown);
  await sleep(1000);
  const c2 = await page.evaluate(() => window.T.countdown);
  await page.evaluate(() => window.T.setRunning(true));
  await sleep(1100);
  const c3 = await page.evaluate(() => window.T.countdown);
  check("countdown: counts down, pause holds, resume continues", c0 < 10 && Math.abs(c2 - c1) < 0.01 && c1 - c3 > 0.8 && c1 - c3 < 1.5, { c0, c1, c2, c3 });

  // STT hook: 25s of fixture speech while on slide 2, then stop()
  await page.evaluate(() => window.T.sttStart(30));
  await page.waitForFunction(() => window.T.stt?.status === "listening" || window.T.stt?.status === "error", { timeout: 15000 });
  const st = await page.evaluate(() => window.T.stt);
  check("stt: hook connects (token → Live)", st.status === "listening", st);
  await sleep(12000);
  await shot(page, `${OUT}/react-stt-mobile.png`);
  await sleep(10000);
  const ret = await page.evaluate(async () => await window.T.sttStop());
  await sleep(300); // let React commit the final state
  const after = await page.evaluate(() => ({ stt: window.T.stt, cb: window.T.onSentence }));
  console.log("after", JSON.stringify({ status: after.stt.status, cb: after.cb.length, ret: ret.length }));
  const ids = new Set(ret.map((x) => x.id));
  check(
    "stt: stop() returns run sentences with id/t(offset 30s)/phase/slide=2, onSentence called",
    ret.length >= 2 && ids.size === ret.length && ret.every((x) => x.phase === "presentation" && x.slide === 2 && x.t >= 30 && /^p[0-9a-z]+-\d+$/.test(x.id)) && after.cb.length === ret.length && after.stt.status === "idle",
    ret,
  );
  const tMono = ret.every((x, i) => i === 0 || x.t >= ret[i - 1].t);
  check("stt: sentence times non-decreasing", tMono, ret.map((x) => x.t));
  // mic released after stop
  const tracks = await page.evaluate(() => window.T.stt.status);
  check("stt: status idle after stop", tracks === "idle", tracks);

  // fullscreen toggle (CSS overlay fallback works in headless)
  await page.click('[data-action="fullscreen"]');
  await sleep(500);
  const fs = await page.evaluate(() => document.querySelector("[data-slide-viewer]")?.getAttribute("data-fullscreen"));
  check("slide: fullscreen toggle", fs === "true", fs);
  await shot(page, `${OUT}/react-slide-fullscreen.png`);
} catch (e) {
  check("harness", false, String(e?.stack ?? e));
  await shot(page, `${OUT}/react-error.png`).catch(() => {});
} finally {
  writeFileSync(`${OUT}/react-results.json`, JSON.stringify({ at: new Date().toISOString(), results, logs: logs.filter((l) => !/DevTools|HMR|Fast Refresh/.test(l)).slice(-60) }, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
