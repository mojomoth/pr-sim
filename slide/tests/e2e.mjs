// E2E verification for the slide PoC (headless Chrome).
// Run from pocs/:  node slide/tests/e2e.mjs
// Writes screenshots + results.json to .verify/slide/.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const OUT = ".verify/slide";
mkdirSync(OUT, { recursive: true });
const results = [];
const metrics = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function state(page) {
  return page.evaluate(() => {
    const r = document.querySelector("[data-state]");
    const track = document.querySelector("[data-slide-track]");
    const vp = document.querySelector("[data-slide-viewport]").getBoundingClientRect();
    const m = /translate3d\((-?[\d.]+)px/.exec(track?.style.transform ?? "");
    return {
      state: r.dataset.state,
      page: Number(r.dataset.page),
      total: Number(r.dataset.total),
      zoom: Number(r.dataset.zoom),
      fullscreen: r.dataset.fullscreen === "true",
      indicator: document.querySelector("[data-page-indicator]")?.textContent,
      trackX: m ? Number(m[1]) : null,
      vp: { x: vp.x, y: vp.y, w: vp.width, h: vp.height },
    };
  });
}
async function waitPage(page, n, timeout = 3000) {
  await page.waitForFunction((n) => Number(document.querySelector("[data-state]")?.dataset.page) === n, { timeout }, n).catch(() => {});
  return state(page);
}
async function waitRendered(page, n, timeout = 10000) {
  const t0 = Date.now();
  await page
    .waitForFunction((n) => document.querySelector(`[data-page-host="${n}"]`)?.dataset.renderState === "done", { timeout, polling: 5 }, n)
    .catch(() => {});
  return Date.now() - t0;
}
async function settle() {
  await sleep(320); // > SNAP_MS
}

// Touch drag via CDP. holdMs > 80 before release ⇒ velocity 0 (pure distance decision).
async function touchDrag(cdp, x0, y0, dx, dy, { steps = 12, stepMs = 16, holdMs = 0, midShot } = {}) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps }] });
    if (stepMs) await sleep(stepMs);
  }
  if (midShot) await midShot();
  if (holdMs) await sleep(holdMs);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function tap(cdp, x, y) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await sleep(30);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

// ─── 1. Mobile touch on the 12-slide deck ───────────────────────────────────
{
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide?sample=presentation`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  await waitRendered(page, 1);
  await sleep(600);
  let s = await state(page);
  check("deck loads 12 pages, indicator 1 / 12", s.total === 12 && s.indicator === "1 / 12", s.indicator);
  const W = s.vp.w;
  const cx = s.vp.x + W / 2;
  const cy = s.vp.y + s.vp.h / 2;
  await shot(page, `${OUT}/m01-loaded.png`);

  // slow swipe left 60% → page 2
  await touchDrag(cdp, cx + W * 0.3, cy, -W * 0.6, 0, { holdMs: 120 });
  s = await waitPage(page, 2);
  check("touch swipe left (60%, slow) → 2", s.page === 2, s.indicator);
  await settle();
  // slow swipe right → 1
  await touchDrag(cdp, cx - W * 0.3, cy, W * 0.6, 0, { holdMs: 120 });
  s = await waitPage(page, 1);
  check("touch swipe right (60%, slow) → 1", s.page === 1, s.indicator);
  await settle();
  // short slow drag (12%) → snap back, stay 1
  await touchDrag(cdp, cx, cy, -W * 0.12, 0, { holdMs: 150 });
  await settle();
  s = await state(page);
  check("short slow drag (12%) snaps back", s.page === 1 && Math.abs(s.trackX) < 1, `page=${s.page} trackX=${s.trackX}`);
  // flick: 45px in ~40ms → next
  await touchDrag(cdp, cx, cy, -45, 0, { steps: 4, stepMs: 8 });
  s = await waitPage(page, 2);
  check("fast flick (45px) → 2", s.page === 2, s.indicator);
  await settle();
  // flick back
  await touchDrag(cdp, cx, cy, 45, 0, { steps: 4, stepMs: 8 });
  s = await waitPage(page, 1);
  check("fast flick right → 1", s.page === 1, s.indicator);
  await settle();

  // mid-drag screenshot (finger following)
  await touchDrag(cdp, cx + W * 0.3, cy, -W * 0.4, 0, {
    holdMs: 120,
    midShot: async () => {
      const m = await state(page);
      check("track follows finger mid-drag", Math.abs(m.trackX + W * 0.4) < 3, `trackX=${m.trackX.toFixed(1)} expected≈${(-W * 0.4).toFixed(1)}`);
      await shot(page, `${OUT}/m02-mid-drag.png`);
    },
  });
  await waitPage(page, 2);
  await settle();
  await page.keyboard.press("Home");
  await waitPage(page, 1);
  await settle();

  // rubber-band at first page: pull right 200px → visual offset much smaller, stays 1
  await touchDrag(cdp, cx - 100, cy, 200, 0, {
    holdMs: 120,
    midShot: async () => {
      const m = await state(page);
      check("rubber-band at first page resists", m.trackX > 0 && m.trackX < 120, `pulled 200px → offset ${m.trackX.toFixed(1)}px`);
      await shot(page, `${OUT}/m03-rubber-band-start.png`);
    },
  });
  await settle();
  s = await state(page);
  check("rubber-band releases back to 1", s.page === 1 && Math.abs(s.trackX) < 1, `trackX=${s.trackX}`);
  // fast flick right at first page must not go below 1
  await touchDrag(cdp, cx, cy, 60, 0, { steps: 4, stepMs: 8 });
  await settle();
  s = await state(page);
  check("flick past first page clamps to 1", s.page === 1, s.indicator);

  // vertical swipe must not change page
  await touchDrag(cdp, cx, cy, 10, -160, { holdMs: 50 });
  await settle();
  s = await state(page);
  check("vertical swipe does not turn page", s.page === 1, s.indicator);
  await page.evaluate(() => window.scrollTo(0, 0));

  // keyboard
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  s = await waitPage(page, 3);
  check("keyboard → → = 3", s.page === 3, s.indicator);
  await page.keyboard.press("ArrowLeft");
  s = await waitPage(page, 2);
  check("keyboard ← = 2", s.page === 2, s.indicator);
  await page.keyboard.press("End");
  s = await waitPage(page, 12);
  check("End → 12 / 12", s.page === 12 && s.indicator === "12 / 12", s.indicator);
  await waitRendered(page, 12);
  await settle();
  // rubber-band at last page
  await touchDrag(cdp, cx + 100, cy, -200, 0, {
    holdMs: 120,
    midShot: async () => {
      const m = await state(page);
      const off = m.trackX + 11 * W;
      check("rubber-band at last page resists", off < 0 && off > -120, `offset ${off.toFixed(1)}px`);
      await shot(page, `${OUT}/m04-rubber-band-end.png`);
    },
  });
  await settle();
  s = await state(page);
  check("stays on 12 after end pull", s.page === 12, s.indicator);
  const nextDisabled = await page.$eval('[data-action="next"]', (b) => b.disabled);
  check("next button disabled on last page", nextDisabled);

  // buttons
  await page.click('[data-action="prev"]');
  s = await waitPage(page, 11);
  check("prev button → 11", s.page === 11, s.indicator);
  await page.click('[data-action="next"]');
  s = await waitPage(page, 12);
  check("next button → 12", s.page === 12, s.indicator);

  // thumbnail jump
  await page.click('[data-thumb="5"]');
  s = await waitPage(page, 5);
  const tms = await waitRendered(page, 5);
  check("thumbnail jump → 5", s.page === 5, `${s.indicator}, rendered in ${tms}ms`);
  await settle();
  await shot(page, `${OUT}/m05-page5.png`);

  // double-tap zoom
  await tap(cdp, cx + 40, cy - 20);
  await sleep(80);
  await tap(cdp, cx + 40, cy - 20);
  await sleep(500);
  s = await state(page);
  check("double-tap zooms in", s.zoom > 2, `zoom=${s.zoom}`);
  // pan while zoomed must not change page
  await touchDrag(cdp, cx, cy, -120, 0, { holdMs: 100 });
  await sleep(400);
  s = await state(page);
  check("drag while zoomed pans (no page change)", s.page === 5 && s.zoom > 2, `page=${s.page} zoom=${s.zoom}`);
  await sleep(400);
  await shot(page, `${OUT}/m06-zoomed.png`);
  await tap(cdp, cx, cy);
  await sleep(80);
  await tap(cdp, cx, cy);
  await sleep(400);
  s = await state(page);
  check("double-tap again resets zoom", s.zoom === 1, `zoom=${s.zoom}`);

  // two-finger pinch-out → zoom, then double-tap to reset
  {
    const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(30) });
    for (let k = 1; k <= 10; k++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(30 + k * 6) });
      await sleep(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(500);
    s = await state(page);
    check("pinch-out zooms (≈3x spread)", s.zoom > 2 && s.page === 5, `zoom=${s.zoom}`);
    await tap(cdp, cx, cy);
    await sleep(80);
    await tap(cdp, cx, cy);
    await sleep(400);
    s = await state(page);
    check("double-tap resets pinch zoom", s.zoom === 1, `zoom=${s.zoom}`);
  }

  // fullscreen
  await page.click('[data-action="fullscreen"]');
  await sleep(500);
  s = await state(page);
  check("fullscreen opens", s.fullscreen, `vp=${Math.round(s.vp.w)}x${Math.round(s.vp.h)}`);
  await waitRendered(page, 5);
  await sleep(400);
  await shot(page, `${OUT}/m07-fullscreen.png`);
  // swipe inside fullscreen
  const fx = s.vp.x + s.vp.w / 2, fy = s.vp.y + s.vp.h / 2;
  await touchDrag(cdp, fx + s.vp.w * 0.3, fy, -s.vp.w * 0.6, 0, { holdMs: 120 });
  s = await waitPage(page, 6);
  check("swipe works in fullscreen", s.page === 6, s.indicator);
  await page.keyboard.press("Escape");
  await sleep(400);
  s = await state(page);
  check("Escape exits fullscreen", !s.fullscreen);

  // Rotation / resize → re-render at new size
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(700);
  const resized = await page.evaluate(() => {
    const h = document.querySelector('[data-page-host="6"]');
    const c = h?.querySelector("canvas");
    return { css: h?.style.width, canvas: c ? `${c.width}x${c.height}` : null, state: h?.dataset.renderState };
  });
  s = await state(page);
  check("landscape rotation re-renders HiDPI canvas", resized.state === "done" && s.page === 6, JSON.stringify(resized));
  await shot(page, `${OUT}/m08-landscape.png`);

  const errs = logs.filter((l) => /\[(error|pageerror)\]|fake worker|Setting up fake worker|requestfailed/i.test(l));
  check("no console errors / fake-worker warnings (mobile)", errs.length === 0, errs.join(" | "));
  metrics.mobileLogs = logs;
  await browser.close();
}

// ─── 2. Desktop mouse drag + keyboard ───────────────────────────────────────
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/slide?sample=presentation`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  await waitRendered(page, 1);
  await sleep(500);
  let s = await state(page);
  const W = s.vp.w, cx = s.vp.x + W / 2, cy = s.vp.y + s.vp.h / 2;
  const mouseDrag = async (dx, steps = 15, stepMs = 16, holdMs = 120) => {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(cx + (dx * i) / steps, cy);
      if (stepMs) await sleep(stepMs);
    }
    if (holdMs) await sleep(holdMs);
    await page.mouse.up();
  };
  await mouseDrag(-W * 0.4);
  s = await waitPage(page, 2);
  check("desktop mouse drag left → 2", s.page === 2, s.indicator);
  await settle();
  await mouseDrag(-W * 0.4);
  s = await waitPage(page, 3);
  check("desktop mouse drag left → 3", s.page === 3, s.indicator);
  await settle();
  await mouseDrag(W * 0.4);
  s = await waitPage(page, 2);
  check("desktop mouse drag right → 2", s.page === 2, s.indicator);
  await settle();
  await mouseDrag(-60, 4, 8, 0);
  s = await waitPage(page, 3);
  check("desktop mouse flick → 3", s.page === 3, s.indicator);
  await settle();
  const selected = await page.evaluate(() => String(window.getSelection()));
  check("mouse drag does not select text", selected === "", JSON.stringify(selected));
  await page.keyboard.press("ArrowRight");
  s = await waitPage(page, 4);
  check("desktop keyboard → 4", s.page === 4, s.indicator);
  await waitRendered(page, 4);
  await sleep(300);
  await shot(page, `${OUT}/d01-desktop-page4.png`);
  // reduced motion: no snap transition
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await sleep(200);
  await page.keyboard.press("ArrowRight");
  s = await waitPage(page, 5);
  const tr = await page.$eval("[data-slide-track]", (e) => e.style.transition);
  check("prefers-reduced-motion → no transition", s.page === 5 && tr.startsWith("none"), `transition=${tr}`);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await sleep(200);
  await page.keyboard.press("ArrowRight");
  await waitPage(page, 6);
  const tr2 = await page.$eval("[data-slide-track]", (e) => e.style.transition);
  check("default motion → 200ms transition", tr2.includes("200ms"), `transition=${tr2}`);
  const errs = logs.filter((l) => /\[(error|pageerror)\]|fake worker|requestfailed/i.test(l));
  check("no console errors (desktop)", errs.length === 0, errs.join(" | "));
  await browser.close();
}

// ─── 3. Long proposal PDF (58p A4): TTFP + swipe responsiveness ─────────────
for (const mode of ["worker", "main"]) {
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.evaluateOnNewDocument(() => {
    window.__longTasks = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longTasks.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true });
  });
  const t0 = Date.now();
  await page.goto(`${BASE}/slide?sample=proposal${mode === "main" ? "&main=1" : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  await waitRendered(page, 1, 20000);
  const wall = Date.now() - t0;
  await sleep(800);
  const m = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-metric]")].map((e) => [e.dataset.metric, e.textContent])));
  let s = await state(page);
  check(`[${mode}] proposal loads 58 pages`, s.total === 58, `${s.indicator}; ttfp(in-app)=${m.ttfp}, load=${m.load}, nav→first paint wall=${wall}ms, renderer=${m.renderer}`);
  metrics[`proposal_${mode}`] = { ttfpInApp: m.ttfp, docLoad: m.load, navToFirstPaintMs: wall, renderer: m.renderer };
  if (mode === "worker") await shot(page, `${OUT}/p01-proposal.png`);

  // 10 consecutive swipes: latency from touchEnd → indicator change, and → page canvas done.
  const W = s.vp.w, cx = s.vp.x + W / 2, cy = s.vp.y + s.vp.h / 2;
  await page.evaluate(() => (window.__longTasks = []));
  const lat = [], paint = [];
  for (let i = 0; i < 10; i++) {
    const before = (await state(page)).page;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx + W * 0.3, y: cy }] });
    for (let k = 1; k <= 8; k++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + W * 0.3 - (W * 0.6 * k) / 8, y: cy }] });
      await sleep(12);
    }
    const tEnd = Date.now();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction((n) => Number(document.querySelector("[data-state]").dataset.page) === n, { polling: "raf", timeout: 3000 }, before + 1).catch(() => {});
    lat.push(Date.now() - tEnd);
    await waitRendered(page, before + 1);
    paint.push(Date.now() - tEnd);
    await sleep(250);
  }
  s = await state(page);
  const longTasks = await page.evaluate(() => window.__longTasks);
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  check(`[${mode}] 10 swipes → page 11`, s.page === 11, `indicator latency avg ${avg(lat)}ms max ${Math.max(...lat)}ms; page painted avg ${avg(paint)}ms max ${Math.max(...paint)}ms; longtasks ${longTasks.length} (max ${Math.max(0, ...longTasks)}ms)`);
  metrics[`proposal_${mode}`].swipe = { indicatorLatencyMs: lat, paintedMs: paint, longTasks };
  // mounted DOM stays bounded (memory cleanup)
  const dom = await page.evaluate(() => ({ hosts: document.querySelectorAll("[data-page-host]").length, canvases: document.querySelectorAll("[data-page-host] canvas").length }));
  check(`[${mode}] only ±2 slides mounted, ≤5 page canvases`, dom.hosts <= 5 && dom.canvases <= 5, JSON.stringify(dom));
  if (mode === "worker") {
    await shot(page, `${OUT}/p02-proposal-page11.png`);
    await page.keyboard.press("End");
    await waitPage(page, 58);
    const t = await waitRendered(page, 58);
    check("[worker] End jumps to 58 and paints", (await state(page)).page === 58, `${t}ms`);
  }
  const errs = logs.filter((l) => /\[(error|pageerror)\]|fake worker|requestfailed/i.test(l));
  check(`[${mode}] no console errors (proposal)`, errs.length === 0, errs.join(" | "));
  await browser.close();
}

// ─── 4. Upload via file input + error cases ─────────────────────────────────
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(`${BASE}/slide`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="pdf-input"]');
  await shot(page, `${OUT}/u01-empty.png`);
  const input = await page.$('[data-testid="pdf-input"]');
  await input.uploadFile(path.resolve("fixtures/proposal.pdf"));
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  await waitRendered(page, 1, 20000);
  await sleep(500);
  let s = await state(page);
  const name = await page.$eval("[data-file-name]", (e) => e.textContent);
  check("file input upload (proposal.pdf) → 58 pages", s.total === 58 && name === "proposal.pdf", `${name} ${s.indicator}`);
  await shot(page, `${OUT}/u02-uploaded.png`);

  // non-PDF file → inline error, viewer untouched
  const tmpTxt = path.resolve(OUT, "not-a-pdf.txt");
  writeFileSync(tmpTxt, "hello");
  await (await page.$('[data-testid="pdf-input"]')).uploadFile(tmpTxt);
  await sleep(300);
  const err1 = await page.$eval('[role="alert"]', (e) => e.textContent).catch(() => null);
  check("non-PDF upload rejected with message", err1 === "PDF 파일만 올릴 수 있어요.", err1);
  // corrupted .pdf → viewer error state
  const badPdf = path.resolve(OUT, "broken.pdf");
  writeFileSync(badPdf, "%PDF-1.4 garbage garbage");
  await (await page.$('[data-testid="pdf-input"]')).uploadFile(badPdf);
  await page.waitForSelector('[data-state="error"]', { timeout: 10000 }).catch(() => {});
  s = await state(page);
  const err2 = await page.$eval('[data-slide-viewport] [role="alert"]', (e) => e.textContent).catch(() => null);
  check("corrupted PDF shows viewer error", s.state === "error" && !!err2, err2);
  await shot(page, `${OUT}/u03-broken.png`);
  const errs = logs.filter((l) => /\[pageerror\]|fake worker|requestfailed/i.test(l));
  check("no page errors (upload)", errs.length === 0, errs.join(" | "));
  metrics.uploadLogs = logs;
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results, metrics }, null, 2));
process.exit(passed === results.length ? 0 : 1);
