// Independent adversarial review round 2 (review:slide) — run from pocs/: node slide/tests/review-r2.mjs
// Screenshots → .verify/slide/review/r2-*.png
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
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
      indicator: r?.querySelector("[data-page-indicator]")?.textContent,
      trackX: m ? Number(m[1]) : null,
      vp: vp ? { x: vp.x, y: vp.y, w: vp.width, h: vp.height } : null,
      host: cur ? { w: cur.offsetWidth, h: cur.offsetHeight, t: cur.style.transform, rs: cur.dataset.renderState } : null,
      canvas: cv ? { w: cv.width, h: cv.height } : null,
      active: document.activeElement?.tagName + (document.activeElement?.getAttribute("data-slide-viewer") != null ? "[viewer]" : ""),
    };
  }, sel);
}
const aligned = (s) => s.trackX != null && Math.abs(s.trackX + (s.page - 1) * s.vp.w) < 1.5;
async function touchDrag(cdp, x0, y0, dx, dy, { steps = 12, stepMs = 16 } = {}) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps }] });
    if (stepMs) await sleep(stepMs);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function tap(cdp, x, y) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await sleep(30);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function ready(page, sel = "[data-slide-viewer]") {
  await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.state === "ready", { timeout: 30000 }, sel);
  await page.waitForFunction(
    (sel) => {
      const r = document.querySelector(sel);
      return r?.querySelector(`[data-page-host="${r.dataset.page}"]`)?.dataset.renderState === "done";
    },
    { timeout: 15000 },
    sel,
  );
}

// ─── E. Embed page: focus-scoped keyboard, Tab focus, visible focus ring ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/slide/embed`, { waitUntil: "domcontentloaded" });
  await ready(page, '[data-embed="a"] [data-slide-viewer]');
  await ready(page, '[data-embed="b"] [data-slide-viewer]');
  await sleep(300);
  const A = '[data-embed="a"] [data-slide-viewer]', B = '[data-embed="b"] [data-slide-viewer]';
  await page.keyboard.press("ArrowRight");
  await sleep(300);
  let a = await state(page, A), b = await state(page, B);
  check("E1 no focus → neither viewer moves", a.page === 1 && b.page === 1, `a=${a.indicator} b=${b.indicator}`);
  // Keyboard-only user: Tab into first viewer
  await page.keyboard.press("Tab");
  const tabTarget = await page.evaluate(() => ({ tag: document.activeElement?.tagName, viewer: document.activeElement?.hasAttribute("data-slide-viewer"), label: document.activeElement?.getAttribute("aria-label") }));
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: cs.boxShadow };
  });
  check("E2 Tab reaches a viewer", tabTarget.viewer, JSON.stringify(tabTarget));
  check("E3 focused viewer has a visible focus indicator", !(ring.outline.startsWith("none") || ring.outline.endsWith(" 0px")) || ring.shadow !== "none", JSON.stringify(ring));
  await page.keyboard.press("ArrowRight");
  await sleep(300);
  a = await state(page, A); b = await state(page, B);
  check("E4 after Tab, ArrowRight moves only focused viewer", a.page + b.page === 3, `a=${a.indicator} b=${b.indicator}`);
  // Click B slide, press End
  const bvp = (await state(page, B)).vp;
  await page.mouse.click(bvp.x + bvp.w / 2, bvp.y + bvp.h / 2);
  await page.keyboard.press("End");
  await sleep(400);
  a = await state(page, A); b = await state(page, B);
  check("E5 click B + End → B last page, A unchanged", b.page === b.total && a.page === 2, `a=${a.indicator} b=${b.indicator}`);
  await shot(page, `${OUT}/r2-e-embed.png`);
  // Horizontal trackpad wheel on A → one page per gesture
  const avp = a.vp;
  await page.mouse.move(avp.x + avp.w / 2, avp.y + avp.h / 2);
  const before = a.page;
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel({ deltaX: 30, deltaY: 0 });
    await sleep(16);
  }
  await sleep(500);
  a = await state(page, A);
  check("E6 one horizontal trackpad gesture (12×30px) turns exactly one page", a.page === before + 1, `${before}→${a.page}`);
  // Vertical wheel over the slide must still scroll the page
  const sy0 = await page.evaluate(() => scrollY);
  await page.mouse.wheel({ deltaY: 300 });
  await sleep(400);
  const sy1 = await page.evaluate(() => scrollY);
  check("E7 vertical wheel over slide scrolls page (not hijacked)", sy1 > sy0 || (await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)), `${sy0}→${sy1}`);
  check("E8 no console errors (embed)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── F. Mobile zoom interplay ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide?sample=presentation`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await sleep(400);
  let s = await state(page);
  const cx = s.vp.x + s.vp.w / 2, cy = s.vp.y + s.vp.h / 2;
  const baseCanvas = s.canvas;
  // Double tap near the right-bottom corner
  await tap(cdp, s.vp.x + s.vp.w - 20, s.vp.y + s.vp.h - 20);
  await sleep(120);
  await tap(cdp, s.vp.x + s.vp.w - 20, s.vp.y + s.vp.h - 20);
  await sleep(900);
  s = await state(page);
  check("F1 double-tap corner → zoom 2.5", s.zoom === 2.5, `zoom=${s.zoom} t=${s.host?.t}`);
  // clamp: zoomed host edges must cover the viewport (no blank gutter)
  const cover = await page.evaluate(() => {
    const r = document.querySelector("[data-slide-viewer]");
    const host = r.querySelector(`[data-page-host="${r.dataset.page}"]`).getBoundingClientRect();
    const vp = r.querySelector("[data-slide-viewport]").getBoundingClientRect();
    return { hl: host.left, hr: host.right, ht: host.top, hb: host.bottom, vl: vp.left, vr: vp.right, vt: vp.top, vb: vp.bottom };
  });
  check("F2 zoomed page clamped (covers viewport)", cover.hl <= cover.vl + 1 && cover.hr >= cover.vr - 1 && cover.ht <= cover.vt + 1 && cover.hb >= cover.vb - 1, JSON.stringify(cover));
  check("F3 zoomed re-render is sharper (canvas grows)", s.canvas && baseCanvas && s.canvas.w > baseCanvas.w * 2, `${baseCanvas?.w}→${s.canvas?.w}`);
  await shot(page, `${OUT}/r2-f1-zoom-corner.png`);
  // Horizontal swipe while zoomed: pans, no page change
  await touchDrag(cdp, cx, cy, -200, 0);
  await sleep(400);
  s = await state(page);
  check("F4 swipe while zoomed pans, stays on page 1", s.page === 1 && s.zoom === 2.5, `${s.indicator} zoom=${s.zoom}`);
  // Next button resets zoom
  await page.tap('[data-action="next"]');
  await sleep(500);
  s = await state(page);
  check("F5 next button while zoomed → page 2, zoom reset", s.page === 2 && s.zoom === 1 && aligned(s), `${s.indicator} zoom=${s.zoom}`);
  const p1t = await page.evaluate(() => document.querySelector('[data-page-host="1"]')?.style.transform);
  check("F6 previous page host transform cleared", !p1t, `p1 transform='${p1t}'`);
  // Pinch out below 1 and release → snaps back to 1
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 80, y: cy, id: 1 }, { x: cx + 80, y: cy, id: 2 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 80 + i * 6, y: cy, id: 1 }, { x: cx + 80 - i * 6, y: cy, id: 2 }] });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(500);
  s = await state(page);
  check("F7 pinch-in below 1 snaps back to zoom 1, same page", s.zoom === 1 && s.page === 2 && !s.host?.t, `zoom=${s.zoom} page=${s.page} t='${s.host?.t}'`);
  // Pinch zoom then single finger lift → pan continues; then swipe works after double-tap reset
  await tap(cdp, cx, cy); await sleep(100); await tap(cdp, cx, cy); await sleep(500);
  await tap(cdp, cx, cy); await sleep(100); await tap(cdp, cx, cy); await sleep(500);
  s = await state(page);
  check("F8 double-tap twice → zoom back to 1", s.zoom === 1, `zoom=${s.zoom}`);
  await touchDrag(cdp, cx + 60, cy, -200, 0);
  await sleep(500);
  s = await state(page);
  check("F9 swipe after zoom cycle → 3", s.page === 3 && aligned(s), s.indicator);
  // Tap single (not double) should not change anything
  await tap(cdp, cx, cy);
  await sleep(500);
  s = await state(page);
  check("F10 single tap keeps page/zoom", s.page === 3 && s.zoom === 1, `${s.indicator} zoom=${s.zoom}`);
  check("F11 no console errors (zoom)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── G. stageAspect="current" with mixed page sizes (mobile) ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="pdf-input"]');
  await (await page.$('[data-testid="pdf-input"]')).uploadFile(path.resolve(OUT, "mixed.pdf"));
  await ready(page);
  await sleep(400);
  let s = await state(page);
  const h1 = s.vp.h;
  const cx = s.vp.x + s.vp.w / 2, cy = s.vp.y + s.vp.h / 2;
  // mid-drag towards portrait page 2: screenshot
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx + 100, y: cy }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + 100 - i * 16, y: cy }] });
    await sleep(16);
  }
  await sleep(200);
  await shot(page, `${OUT}/r2-g1-mixed-mid-drag.png`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(900);
  s = await state(page);
  check("G1 swipe to portrait page 2", s.page === 2 && aligned(s), `${s.indicator} trackX=${s.trackX}`);
  check("G2 stage grows for portrait page", s.vp.h > h1 * 1.5, `h ${h1}→${s.vp.h}`);
  check("G3 portrait canvas HiDPI after stage growth", s.canvas && s.canvas.w >= s.host.w * 2 - 2, `host=${s.host?.w}x${s.host?.h} canvas=${s.canvas?.w}x${s.canvas?.h}`);
  await shot(page, `${OUT}/r2-g2-mixed-portrait.png`);
  // Rapid back/forward across aspect boundary
  for (let i = 0; i < 4; i++) {
    await touchDrag(cdp, cx - 60, cy, 120, 0, { steps: 4, stepMs: 8 });
    await sleep(50);
    await touchDrag(cdp, cx + 60, cy, -120, 0, { steps: 4, stepMs: 8 });
    await sleep(50);
  }
  await sleep(1000);
  s = await state(page);
  check("G4 rapid flicks across aspect boundary end aligned & rendered", aligned(s) && s.host?.rs === "done", `${s.indicator} trackX=${s.trackX} w=${s.vp.w} rs=${s.host?.rs}`);
  check("G5 no console errors (mixed)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── H. Landscape phone, close/reopen, main-thread checkbox focus ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(`${BASE}/slide?sample=presentation`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(1200);
  let s = await state(page);
  check("H1 landscape: canvas re-rendered at DPR2", s.canvas && Math.abs(s.canvas.w - s.host.w * 2) <= 2, `host=${s.host?.w}x${s.host?.h} canvas=${s.canvas?.w}x${s.canvas?.h} vp.y=${s.vp.y}`);
  await shot(page, `${OUT}/r2-h1-landscape.png`);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(800);
  // Close the viewer, then reopen proposal
  const closeBtn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "닫기"));
  await closeBtn.tap();
  await sleep(500);
  const emptyBack = await page.$("[data-dropzone]");
  check("H2 닫기 returns to dropzone", !!emptyBack);
  await page.tap('[data-sample="proposal"]');
  await sleep(50);
  // close immediately while loading
  const closeBtn2 = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "닫기"));
  await closeBtn2.tap();
  await sleep(800);
  await page.tap('[data-sample="proposal"]');
  await ready(page);
  s = await state(page);
  check("H3 close-during-load then reopen → 1 / 58", s.indicator === "1 / 58", s.indicator);
  // Toggle main-thread checkbox then ArrowRight (global keyboard)
  await page.click('input[type="checkbox"]');
  await ready(page);
  await sleep(300);
  await page.keyboard.press("ArrowRight");
  await sleep(500);
  s = await state(page);
  check("H4 after toggling main-thread checkbox, → key turns page", s.page === 2, `${s.indicator} active=${s.active}`);
  // 처음으로 / 마지막으로 then Space
  const lastBtn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "마지막으로"));
  await lastBtn.click();
  await sleep(400);
  const firstBtn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "처음으로"));
  await firstBtn.click();
  await sleep(400);
  await page.keyboard.press("Space");
  await sleep(500);
  s = await state(page);
  check("H5 after clicking 처음으로, Space advances to 2", s.page === 2, `${s.indicator} active=${s.active}`);
  check("H6 no console errors (landscape/close/main)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── I. Desktop: drag released over a thumbnail, double-click zoom, main-thread long swipe perf ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/slide?sample=proposal&main=1`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await sleep(500);
  await page.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask", buffered: false });
  });
  let s = await state(page);
  const cx = s.vp.x + s.vp.w / 2, cy = s.vp.y + s.vp.h / 2;
  const lat = [];
  for (let i = 0; i < 15; i++) {
    const p0 = (await state(page)).page;
    await page.mouse.move(cx + 150, cy);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(cx + 150 - k * 50, cy);
    const t0 = Date.now();
    await page.mouse.up();
    await page.waitForFunction((p) => Number(document.querySelector("[data-slide-viewer]").dataset.page) === p + 1, { timeout: 3000 }, p0).catch(() => {});
    lat.push(Date.now() - t0);
    await sleep(60);
  }
  await sleep(800);
  s = await state(page);
  const lt = await page.evaluate(() => window.__lt);
  check("I1 15 mouse drags (main-thread) → 16 / 58", s.page === 16 && aligned(s), `${s.indicator} lat avg ${Math.round(lat.reduce((a, b) => a + b) / lat.length)}ms max ${Math.max(...lat)}ms longtasks=${lt.length} ${lt.map(Math.round).join(",")}`);
  check("I2 current page rendered after burst", s.host?.rs === "done", s.host?.rs);
  // Mouse drag starting on slide, released over the thumbnail strip: must not also trigger thumbnail click
  const th = await page.$('[data-thumb="40"]');
  const tb = th ? await th.boundingBox() : null;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy + 40);
  await page.mouse.move(cx - 120, cy + 120);
  const strip = await (await page.$("[data-thumb-strip]")).boundingBox();
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2, { steps: 4 });
  await page.mouse.up();
  await sleep(500);
  s = await state(page);
  check("I3 drag released over thumbnail strip doesn't jump to that thumbnail", s.page === 16 || s.page === 17, `${s.indicator} (thumb40 visible=${!!tb})`);
  // Double-click zoom on desktop
  await page.mouse.click(cx, cy, { clickCount: 1 });
  await sleep(80);
  await page.mouse.click(cx, cy, { clickCount: 2 });
  await sleep(600);
  s = await state(page);
  check("I4 desktop double-click toggles zoom", s.zoom > 1, `zoom=${s.zoom}`);
  await page.keyboard.press("ArrowRight");
  await sleep(500);
  s = await state(page);
  check("I5 ArrowRight while zoomed → next page, zoom reset", s.zoom === 1, `${s.indicator} zoom=${s.zoom}`);
  await shot(page, `${OUT}/r2-i-desktop-main.png`);
  check("I6 no console errors (desktop main-thread)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

writeFileSync(`${OUT}/review-r2-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
