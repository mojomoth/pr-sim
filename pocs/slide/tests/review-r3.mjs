// Independent adversarial review round 3 (review:slide) — run from pocs/: node slide/tests/review-r3.mjs
// Screenshots → .verify/slide/review/r3-*.png
import { writeFileSync, mkdirSync, openSync, ftruncateSync, closeSync } from "node:fs";
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const OUT = ".verify/slide/review";
mkdirSync(OUT, { recursive: true });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const consoleBad = (logs) => logs.filter((l) => /^\[(error|pageerror|requestfailed)\]|fake worker|Setting up fake/i.test(l));

async function state(page, sel = "[data-slide-viewer]") {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel);
    const track = r?.querySelector("[data-slide-track]");
    const vpEl = r?.querySelector("[data-slide-viewport]");
    const vp = vpEl?.getBoundingClientRect();
    const m = /translate3d\((-?[\d.]+)px/.exec(track?.style.transform ?? "");
    const cur = r?.querySelector(`[data-page-host="${r?.dataset.page}"]`);
    const cv = cur?.querySelector("canvas");
    return {
      state: r?.dataset.state,
      page: Number(r?.dataset.page),
      total: Number(r?.dataset.total),
      zoom: Number(r?.dataset.zoom),
      fs: r?.dataset.fullscreen,
      indicator: r?.querySelector("[data-page-indicator]")?.textContent,
      trackX: m ? Number(m[1]) : null,
      vp: vp ? { x: vp.x, y: vp.y, w: vp.width, h: vp.height } : null,
      host: cur ? { w: cur.offsetWidth, h: cur.offsetHeight, t: cur.style.transform, rs: cur.dataset.renderState } : null,
      canvas: cv ? { w: cv.width, h: cv.height } : null,
      thumbsDone: [...(r?.querySelectorAll("[data-thumb]") ?? [])].map((b) => !!b.querySelector("canvas") && !b.querySelector("span.absolute.flex")),
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      err: r?.querySelector('[role="alert"]')?.textContent ?? null,
    };
  }, sel);
}
const aligned = (s) => s.trackX != null && Math.abs(s.trackX + (s.page - 1) * s.vp.w) < 1.5;
async function touchDrag(cdp, x0, y0, dx, dy, { steps = 12, stepMs = 16, end = "touchEnd" } = {}) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps }] });
    if (stepMs) await sleep(stepMs);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: end, touchPoints: [] });
}
async function ready(page, sel = "[data-slide-viewer]", timeout = 15000) {
  await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.state === "ready", { timeout: 30000 }, sel);
  await page.waitForFunction(
    (sel) => {
      const r = document.querySelector(sel);
      return r?.querySelector(`[data-page-host="${r.dataset.page}"]`)?.dataset.renderState === "done";
    },
    { timeout },
    sel,
  );
}

// ─── J. Rapid document switching while thumbnails are queued (module-global thumbQueue) ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(`${BASE}/slide`, { waitUntil: "networkidle0" });
  for (let k = 0; k < 6; k++) {
    await page.click(`[data-sample="${k % 2 ? "presentation" : "proposal"}"]`);
    await sleep(k < 3 ? 120 : 400);
  }
  await page.click('[data-sample="presentation"]');
  let ok = true;
  try {
    await ready(page);
  } catch {
    ok = false;
  }
  check("J1 after 7 rapid sample switches, final deck (presentation) renders page 1", ok && (await state(page)).indicator === "1 / 12", (await state(page)).indicator);
  await sleep(2500);
  let s = await state(page);
  const vis = s.thumbsDone.slice(0, 5);
  check("J2 thumbnails of final deck render (queue not stalled by destroyed docs)", vis.every(Boolean), JSON.stringify(s.thumbsDone));
  await shot(page, `${OUT}/r3-j-switch.png`);
  check("J3 no console errors (switching)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── K. Mobile: swipe during first render, pointercancel, horizontal overflow, fullscreen sharpness ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide`, { waitUntil: "networkidle0" });
  let s = await state(page);
  check("K0 empty page: no horizontal overflow at 390", s.scrollW <= s.innerW, `scrollW=${s.scrollW}`);
  await page.click('[data-sample="presentation"]');
  await page.waitForFunction(() => document.querySelector("[data-slide-viewer]")?.dataset.state === "ready", { timeout: 30000 });
  s = await state(page);
  const cx = s.vp.x + s.vp.w / 2, cy = s.vp.y + s.vp.h / 2;
  // swipe immediately (page 1 may still be rendering)
  await touchDrag(cdp, cx + 120, cy, -260, 0, { steps: 8, stepMs: 12 });
  await sleep(500);
  await ready(page);
  s = await state(page);
  check("K1 swipe right after load → 2 / 12, rendered, aligned", s.page === 2 && aligned(s) && s.host?.rs === "done", `${s.indicator} rs=${s.host?.rs}`);
  check("K2 no horizontal overflow with viewer at 390", s.scrollW <= s.innerW, `scrollW=${s.scrollW}`);
  // pointercancel mid-swipe (system gesture steals touch)
  await touchDrag(cdp, cx + 120, cy, -200, 0, { steps: 6, end: "touchCancel" });
  await sleep(400);
  s = await state(page);
  check("K3 touchCancel mid-swipe → stays 2, snaps back aligned", s.page === 2 && aligned(s), `${s.indicator} trackX=${s.trackX}`);
  // next swipe still works after cancel
  await touchDrag(cdp, cx + 120, cy, -240, 0);
  await sleep(400);
  s = await state(page);
  check("K4 swipe after cancel → 3", s.page === 3 && aligned(s), s.indicator);
  // horizontal touch scroll of the thumbnail strip must not turn pages
  const strip = await page.evaluate(() => {
    const r = document.querySelector("[data-thumb-strip]").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await touchDrag(cdp, strip.x + 100, strip.y, -200, 0);
  await sleep(500);
  s = await state(page);
  check("K5 swiping the thumbnail strip doesn't change slide", s.page === 3, s.indicator);
  check("K6 still no horizontal page overflow", s.scrollW <= s.innerW, `scrollW=${s.scrollW}`);
  // swipe started during the snap animation: measure the visual jump
  s = await state(page);
  await touchDrag(cdp, cx + 120, cy, -240, 0, { steps: 6, stepMs: 10 });
  await sleep(40);
  const midAnim = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector("[data-slide-track]")).transform).m41);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 10, y: cy }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 12, y: cy }] });
  await sleep(30);
  const afterGrab = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector("[data-slide-track]")).transform).m41);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  s = await state(page);
  const jump = Math.abs(afterGrab - midAnim);
  check("K7 grabbing during snap animation: no big visual jump (<60px)", jump < 60, `mid-anim x=${midAnim.toFixed(1)} after grab x=${afterGrab.toFixed(1)} jump=${jump.toFixed(1)} page=${s.indicator}`);
  // fullscreen sharpness
  await page.click('[data-action="fullscreen"]');
  await sleep(900);
  s = await state(page);
  check("K8 fullscreen canvas re-rendered at DPR2 for the larger stage", s.fs === "true" && s.canvas && Math.abs(s.canvas.w - s.host.w * 2) <= 2, `fs=${s.fs} host=${s.host?.w}x${s.host?.h} canvas=${s.canvas?.w}x${s.canvas?.h}`);
  await shot(page, `${OUT}/r3-k-fullscreen.png`);
  const before = s.page;
  s = await state(page);
  await touchDrag(cdp, s.vp.x + s.vp.w / 2 + 100, s.vp.y + s.vp.h / 2, -220, 0);
  await sleep(400);
  s = await state(page);
  check("K9 swipe in fullscreen", s.page === before + 1 && aligned(s), s.indicator);
  await page.click('[data-action="fullscreen"]');
  await sleep(600);
  s = await state(page);
  check("K10 exit fullscreen → aligned, canvas back to DPR2 of small host", s.fs === "false" && aligned(s) && s.canvas && Math.abs(s.canvas.w - s.host.w * 2) <= 2, `host=${s.host?.w} canvas=${s.canvas?.w}`);
  check("K11 no console errors (mobile r3)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── L. Upload edge cases: empty .pdf, >100MB, single page swipes, same file twice ──
{
  writeFileSync(`${OUT}/empty.pdf`, "");
  const fd = openSync(`${OUT}/huge.pdf`, "w");
  ftruncateSync(fd, 101 * 1024 * 1024);
  closeSync(fd);
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide`, { waitUntil: "networkidle0" });
  const input = await page.$('[data-testid="pdf-input"]');
  await input.uploadFile(`${OUT}/huge.pdf`);
  await sleep(500);
  let alert = await page.evaluate(() => document.querySelector('aside [role="alert"]')?.textContent ?? "");
  check("L1 >100MB file → size error, nothing opened", /너무 커요/.test(alert) && !(await page.$("[data-slide-viewer]")), alert);
  await input.uploadFile(`${OUT}/empty.pdf`);
  await page.waitForFunction(() => ["error", "ready"].includes(document.querySelector("[data-slide-viewer]")?.dataset.state), { timeout: 15000 }).catch(() => {});
  let s = await state(page);
  check("L2 empty .pdf → Korean error in viewer", s.state === "error" && /PDF/.test(s.err ?? ""), `state=${s.state} err=${s.err}`);
  await shot(page, `${OUT}/r3-l-empty.png`);
  await input.uploadFile(`${OUT}/single.pdf`);
  await ready(page);
  s = await state(page);
  const cx = s.vp.x + s.vp.w / 2, cy = s.vp.y + s.vp.h / 2;
  await touchDrag(cdp, cx, cy, -300, 0);
  await sleep(400);
  const s1 = await state(page);
  await touchDrag(cdp, cx, cy, 300, 0);
  await sleep(400);
  const s2 = await state(page);
  check("L3 single-page: swipes both ways stay 1 / 1, aligned", s1.indicator === "1 / 1" && s2.indicator === "1 / 1" && aligned(s2), `${s1.indicator} ${s2.indicator} x=${s2.trackX}`);
  // Same file uploaded twice in a row should reopen (input value reset)
  await page.keyboard.press("End");
  await input.uploadFile(`${OUT}/mixed.pdf`);
  await ready(page);
  await page.keyboard.press("End");
  await sleep(400);
  await input.uploadFile(`${OUT}/mixed.pdf`);
  await sleep(300);
  await ready(page);
  s = await state(page);
  check("L4 re-uploading the same file reopens at page 1", s.indicator === "1 / 3", s.indicator);
  const bad = consoleBad(logs).filter((l) => !/Invalid PDF|InvalidPDF|empty|zero/i.test(l));
  check("L5 no unexpected console errors (uploads)", bad.length === 0, bad.slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── M. Desktop long deck: held → key (auto-repeat) to the end, Home, resize while zoomed ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/slide?sample=proposal`, { waitUntil: "domcontentloaded" });
  await ready(page, "[data-slide-viewer]", 20000);
  await shot(page, `${OUT}/r3-m-desktop-1440.png`);
  const t0 = Date.now();
  for (let i = 0; i < 70; i++) await page.keyboard.press("ArrowRight", { delay: 0 }); // overshoots past 58
  let s = await state(page);
  check("M1 70× → presses clamp at 58 / 58", s.page === 58 && aligned(s), `${s.indicator} in ${Date.now() - t0}ms`);
  const tr = Date.now();
  await ready(page);
  check("M2 last page renders after burst", true, `${Date.now() - tr}ms after burst`);
  const canv = await page.evaluate(() => document.querySelectorAll("[data-page-host] canvas").length);
  check("M3 page canvases bounded (≤5)", canv <= 5, `canvases=${canv}`);
  await page.keyboard.press("Home");
  const th = Date.now();
  await ready(page);
  s = await state(page);
  check("M4 Home → 1 / 58 rendered", s.page === 1 && aligned(s), `${s.indicator} render ${Date.now() - th}ms`);
  // double-click zoom then shrink window → zoomed page must stay clamped (no empty gap)
  const vp = s.vp;
  await page.mouse.click(vp.x + vp.w / 2 + 120, vp.y + vp.h / 2 - 200, { clickCount: 1 });
  await page.mouse.click(vp.x + vp.w / 2 + 120, vp.y + vp.h / 2 - 200, { clickCount: 2 });
  await sleep(500);
  s = await state(page);
  const zoomedOk = s.zoom > 1;
  await page.setViewport({ width: 800, height: 900 });
  await sleep(900);
  const cover = await page.evaluate(() => {
    const r = document.querySelector("[data-slide-viewer]");
    const h = r.querySelector(`[data-page-host="${r.dataset.page}"]`).getBoundingClientRect();
    const v = r.querySelector("[data-slide-viewport]").getBoundingClientRect();
    return { hl: h.left, hr: h.right, vl: v.left, vr: v.right, hw: h.width, vw: v.width };
  });
  s = await state(page);
  check(
    "M5 zoomed then window resized: zoom kept or reset, but host still sane (not off-screen)",
    zoomedOk && cover.hr > cover.vl && cover.hl < cover.vr,
    `zoom=${s.zoom} host[${cover.hl.toFixed(0)},${cover.hr.toFixed(0)}] vp[${cover.vl.toFixed(0)},${cover.vr.toFixed(0)}]`,
  );
  await shot(page, `${OUT}/r3-m-resized-zoomed.png`);
  check("M6 no console errors (desktop long)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── N. Embed on mobile: touch swipes only move the touched viewer ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide/embed`, { waitUntil: "domcontentloaded" });
  const A = '[data-embed="a"] [data-slide-viewer]', B = '[data-embed="b"] [data-slide-viewer]';
  await ready(page, A);
  await ready(page, B);
  let a = await state(page, A);
  await touchDrag(cdp, a.vp.x + a.vp.w / 2 + 80, a.vp.y + a.vp.h / 2, -220, 0);
  await sleep(400);
  a = await state(page, A);
  let b = await state(page, B);
  check("N1 swipe on viewer A only moves A", a.page === 2 && b.page === 1, `a=${a.indicator} b=${b.indicator}`);
  await page.evaluate(() => document.querySelector('[data-embed="b"]').scrollIntoView());
  await sleep(300);
  b = await state(page, B);
  await touchDrag(cdp, b.vp.x + b.vp.w / 2 + 80, b.vp.y + b.vp.h / 2, -220, 0);
  await sleep(500);
  a = await state(page, A);
  b = await state(page, B);
  check("N2 swipe on viewer B (A4 portrait) only moves B", a.page === 2 && b.page === 2, `a=${a.indicator} b=${b.indicator}`);
  await shot(page, `${OUT}/r3-n-embed-mobile.png`);
  check("N3 no console errors (embed mobile)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
writeFileSync(`${OUT}/review-r3-results.json`, JSON.stringify(results, null, 2));
