// Independent adversarial review (review:slide) — run from pocs/: node slide/tests/review-e2e.mjs
// Screenshots → .verify/slide/review/
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
async function state(page) {
  return page.evaluate(() => {
    const r = document.querySelector("[data-state]");
    const track = document.querySelector("[data-slide-track]");
    const vpEl = document.querySelector("[data-slide-viewport]");
    const vp = vpEl?.getBoundingClientRect();
    const m = /translate3d\((-?[\d.]+)px/.exec(track?.style.transform ?? "");
    return {
      state: r?.dataset.state,
      page: Number(r?.dataset.page),
      total: Number(r?.dataset.total),
      zoom: Number(r?.dataset.zoom),
      fullscreen: r?.dataset.fullscreen === "true",
      indicator: document.querySelector("[data-page-indicator]")?.textContent,
      trackX: m ? Number(m[1]) : null,
      vp: vp ? { x: vp.x, y: vp.y, w: vp.width, h: vp.height } : null,
      metricPage: document.querySelector('[data-metric="page"]')?.textContent,
      fileInfo: document.querySelector("[data-file-name]")?.nextElementSibling?.textContent,
      canvases: document.querySelectorAll("[data-page-host] canvas").length,
      hosts: [...document.querySelectorAll("[data-page-host]")].map((h) => `${h.dataset.pageHost}:${h.dataset.renderState}`),
      alertText: [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" | "),
      bodyOverflow: document.body.style.overflow,
      scrollY: window.scrollY,
    };
  });
}
const aligned = (s) => s.trackX != null && Math.abs(s.trackX + (s.page - 1) * s.vp.w) < 1.5;
async function waitPage(page, n, timeout = 3000) {
  await page.waitForFunction((n) => Number(document.querySelector("[data-state]")?.dataset.page) === n, { timeout }, n).catch(() => {});
  return state(page);
}
async function waitRendered(page, n, timeout = 10000) {
  const t0 = Date.now();
  const ok = await page
    .waitForFunction((n) => document.querySelector(`[data-page-host="${n}"]`)?.dataset.renderState === "done", { timeout, polling: 10 }, n)
    .then(() => true)
    .catch(() => false);
  return ok ? Date.now() - t0 : -1;
}
async function touchDrag(cdp, x0, y0, dx, dy, { steps = 12, stepMs = 16, holdMs = 0 } = {}) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps }] });
    if (stepMs) await sleep(stepMs);
  }
  if (holdMs) await sleep(holdMs);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const consoleBad = (logs) => logs.filter((l) => /^\[(error|pageerror|requestfailed)\]|fake worker|Setting up fake/i.test(l));

// ─── A. Mobile: rapid flicks during snap, sample re-click, Space after sample click ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-sample="presentation"]');
  await shot(page, `${OUT}/r00-empty-mobile.png`, { fullPage: true });
  // Tap the sample button (real user flow, not ?sample=)
  await page.tap('[data-sample="presentation"]');
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  await waitRendered(page, 1);
  await sleep(500);
  let s = await state(page);
  check("A1 sample button → 1 / 12", s.indicator === "1 / 12", s.indicator);
  const W = s.vp.w, cx = s.vp.x + W / 2, cy = s.vp.y + s.vp.h / 2;

  // 5 rapid flicks, each starting while the previous snap animation is still running
  for (let i = 0; i < 5; i++) {
    await touchDrag(cdp, cx + 40, cy, -60, 0, { steps: 4, stepMs: 8 });
    await sleep(60);
  }
  await sleep(400);
  s = await state(page);
  check("A2 5 rapid flicks → 6 / 12, track aligned", s.page === 6 && aligned(s), `${s.indicator} trackX=${s.trackX} expected=${-(s.page - 1) * W}`);
  const r6 = await waitRendered(page, s.page, 4000);
  check("A3 page after rapid flicks gets rendered", r6 >= 0, `hosts=${(await state(page)).hosts.join(",")}`);
  await shot(page, `${OUT}/r01-after-rapid-flicks.png`);

  // Mid-swipe second flick back and forth quickly
  await touchDrag(cdp, cx - 40, cy, 60, 0, { steps: 4, stepMs: 8 });
  await sleep(40);
  await touchDrag(cdp, cx + 40, cy, -60, 0, { steps: 4, stepMs: 8 });
  await sleep(400);
  s = await state(page);
  check("A4 back+forward flick during animation → 6, aligned", s.page === 6 && aligned(s), `${s.indicator} trackX=${s.trackX}`);

  // Vertical touch scroll over the slide actually scrolls the page (touch-action: pan-y)
  await page.evaluate(() => window.scrollTo(0, 0));
  const before = (await state(page)).scrollY;
  await touchDrag(cdp, cx, cy + 60, 0, -200, { steps: 10, stepMs: 16 });
  await sleep(500);
  s = await state(page);
  check("A5 vertical swipe over slide scrolls page, no page change", s.scrollY > before && s.page === 6, `scrollY ${before}→${s.scrollY}, page=${s.page}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);

  // Re-tap the same (already active) sample button
  await page.tap('[data-sample="presentation"]');
  await sleep(1500);
  s = await state(page);
  check("A6 re-tap active sample: metrics/file info not stuck", s.metricPage !== "–" && !/불러오는 중/.test(s.fileInfo ?? ""), `metricPage=${s.metricPage} fileInfo=${s.fileInfo} viewerPage=${s.indicator}`);
  await shot(page, `${OUT}/r02-retap-sample.png`, { fullPage: true });
  check("A7 no console errors (mobile)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── B. Desktop: click sample then Space / keyboard; resize; fullscreen; mouse release outside ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/slide`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-sample="presentation"]');
  await page.click('[data-sample="presentation"]');
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  await waitRendered(page, 1);
  await sleep(400);
  // Focus is now on the sample button. Press ArrowRight (should work), then Space (presenter habit).
  await page.keyboard.press("ArrowRight");
  let s = await waitPage(page, 2);
  check("B1 ArrowRight after clicking sample button → 2", s.page === 2, s.indicator);
  const focusTag = await page.evaluate(() => `${document.activeElement?.tagName}[${document.activeElement?.getAttribute("data-sample") ?? ""}]`);
  await page.keyboard.press("Space");
  await sleep(1200);
  s = await state(page);
  check("B2 Space (focus on sample button) advances or at least keeps page/metrics", s.page >= 2 && s.metricPage !== "–", `focus=${focusTag} page=${s.page} indicator=${s.indicator} metricPage=${s.metricPage} fileInfo=${s.fileInfo}`);
  await shot(page, `${OUT}/r03-desktop-space-after-sample-click.png`);

  // Click on body area (blur), go to page 4
  await page.click("h1");
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  s = await waitPage(page, 4);
  check("B3 keyboard to 4", s.page === 4, s.indicator);
  await sleep(400);

  // Mouse drag released OUTSIDE the viewport (over the sidebar)
  s = await state(page);
  const cx = s.vp.x + s.vp.w / 2, cy = s.vp.y + s.vp.h / 2;
  await page.mouse.move(cx + 100, cy);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(cx + 100 - i * 30, cy + i * 25);
    await sleep(16);
  }
  await sleep(150);
  await page.mouse.up();
  await sleep(400);
  s = await state(page);
  check("B4 mouse drag released outside viewport → 5, aligned", s.page === 5 && aligned(s), `${s.indicator} trackX=${s.trackX}`);
  // Next drag still works (no stuck gesture state)
  await page.mouse.move(cx + 100, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(cx + 100 + i * 30, cy);
    await sleep(16);
  }
  await sleep(150);
  await page.mouse.up();
  s = await waitPage(page, 4);
  await sleep(300);
  check("B5 subsequent mouse drag right → 4", s.page === 4 && aligned(await state(page)), s.indicator);

  // Resize desktop → narrow
  await page.setViewport({ width: 700, height: 800 });
  await sleep(900);
  s = await state(page);
  check("B6 after resize 1280→700 track aligned on 4", s.page === 4 && aligned(s), `W=${s.vp.w} trackX=${s.trackX}`);
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('[data-page-host="4"] canvas');
    const h = document.querySelector('[data-page-host="4"]').getBoundingClientRect();
    return { cw: c?.width, hostW: h.width, dpr: devicePixelRatio };
  });
  check("B7 canvas re-rendered to new width (HiDPI)", canvasInfo.cw == null || Math.abs(canvasInfo.cw - canvasInfo.hostW * canvasInfo.dpr) < 4 || canvasInfo.cw === 0, JSON.stringify(canvasInfo));
  await shot(page, `${OUT}/r04-desktop-resized.png`);
  await page.setViewport({ width: 1280, height: 860 });
  await sleep(700);

  // Fullscreen button open → swipe via mouse → close via button
  await page.click('[data-action="fullscreen"]');
  await sleep(700);
  s = await state(page);
  check("B8 fullscreen opens", s.fullscreen, `bodyOverflow=${s.bodyOverflow}`);
  await shot(page, `${OUT}/r05-desktop-fullscreen.png`);
  const fx = s.vp.x + s.vp.w / 2, fy = s.vp.y + s.vp.h / 2;
  await page.mouse.move(fx + 200, fy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(fx + 200 - i * 45, fy);
    await sleep(16);
  }
  await sleep(150);
  await page.mouse.up();
  s = await waitPage(page, 5);
  await sleep(300);
  s = await state(page);
  check("B9 drag inside fullscreen → 5, aligned", s.page === 5 && aligned(s), `${s.indicator} trackX=${s.trackX} W=${s.vp.w}`);
  await page.click('[data-action="fullscreen"]');
  await sleep(800);
  s = await state(page);
  check("B10 fullscreen closes, track aligned, body overflow restored", !s.fullscreen && aligned(s) && s.bodyOverflow === "", `fs=${s.fullscreen} trackX=${s.trackX} W=${s.vp.w} overflow='${s.bodyOverflow}'`);
  await shot(page, `${OUT}/r06-desktop-after-fullscreen.png`);
  check("B11 no console errors (desktop)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── C. Long proposal: thumbnail far jump, rapid key presses, memory bounds ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  const t0 = Date.now();
  await page.goto(`${BASE}/slide?sample=proposal`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  await waitRendered(page, 1);
  const wall = Date.now() - t0;
  const ttfp = await page.$eval('[data-metric="ttfp"]', (e) => e.textContent);
  let s = await state(page);
  check("C1 proposal loads 58 pages", s.total === 58, `${s.indicator}, nav→first page wall ${wall}ms, in-app ttfp ${ttfp}`);
  await shot(page, `${OUT}/r07-proposal.png`);
  // 20 rapid ArrowRight presses
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  s = await waitPage(page, 21);
  const rr = await waitRendered(page, 21, 5000);
  s = await state(page);
  check("C2 20 rapid → presses → 21, rendered, aligned", s.page === 21 && rr >= 0 && aligned(s), `${s.indicator} render wait=${rr}ms canvases=${s.canvases} hosts=${s.hosts.join(",")}`);
  await sleep(1500);
  s = await state(page);
  check("C3 bounded canvases (≤5) and no host stuck in rendering", s.canvases <= 5 && !s.hosts.some((h) => h.endsWith("rendering")), `canvases=${s.canvases} hosts=${s.hosts.join(",")}`);
  // Swipe through 12 pages quickly via touch, measuring release→indicator
  const W = s.vp.w, cx = s.vp.x + W / 2, cy = s.vp.y + s.vp.h / 2;
  const lat = [];
  for (let i = 0; i < 12; i++) {
    const before = (await state(page)).page;
    await touchDrag(cdp, cx + 40, cy, -80, 0, { steps: 5, stepMs: 8 });
    const tr = Date.now();
    await page.waitForFunction((n) => Number(document.querySelector("[data-state]").dataset.page) === n, { timeout: 2000, polling: "raf" }, before + 1).catch(() => {});
    lat.push(Date.now() - tr);
    await sleep(120);
  }
  s = await state(page);
  const rr2 = await waitRendered(page, s.page, 5000);
  check("C4 12 quick touch flicks → 33, rendered", s.page === 33 && rr2 >= 0, `page=${s.page} release→indicator avg ${Math.round(lat.reduce((a, b) => a + b, 0) / lat.length)}ms max ${Math.max(...lat)}ms; render wait ${rr2}ms`);
  // Thumbnail far jump: scroll strip and click thumb 50
  await page.evaluate(() => document.querySelector('[data-thumb="50"]').scrollIntoView({ inline: "center" }));
  await sleep(300);
  await page.$eval('[data-thumb="50"]', (b) => b.click());
  s = await waitPage(page, 50);
  const r50 = await waitRendered(page, 50, 5000);
  await sleep(1200);
  const neigh = (await state(page)).hosts;
  check("C5 thumbnail jump → 50 rendered, neighbors 49/51 pre-rendered", s.page === 50 && r50 >= 0 && neigh.includes("49:done") && neigh.includes("51:done"), `render ${r50}ms hosts=${neigh.join(",")}`);
  // Thumbs rendered near 50?
  const thumbsDone = await page.evaluate(() => [48, 49, 50, 51, 52].map((n) => !!document.querySelector(`[data-thumb="${n}"] canvas`)));
  check("C6 thumbnails near current page rendered", thumbsDone.every(Boolean), JSON.stringify(thumbsDone));
  await shot(page, `${OUT}/r08-proposal-page50.png`);
  const thumbCanvases = await page.evaluate(() => document.querySelectorAll("[data-thumb] canvas").length);
  const dupThumbs = await page.evaluate(() => [...document.querySelectorAll("[data-thumb]")].filter((b) => b.querySelectorAll("canvas").length > 1).map((b) => b.dataset.thumb));
  check("C7 no duplicate thumbnail canvases", dupThumbs.length === 0, `thumb canvases=${thumbCanvases} dups=${dupThumbs.join(",")}`);
  check("C8 no console errors (proposal)", consoleBad(logs).length === 0, consoleBad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ─── D. Uploads: mixed page sizes, encrypted, single page, drag&drop, same-name reupload ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="pdf-input"]');
  const input = async () => page.$('[data-testid="pdf-input"]');
  await (await input()).uploadFile(path.resolve(OUT, "mixed.pdf"));
  await page.waitForSelector('[data-state="ready"]', { timeout: 15000 });
  await waitRendered(page, 1);
  let s = await state(page);
  check("D1 mixed.pdf uploads, 3 pages", s.total === 3, s.indicator);
  await page.click('[data-action="next"]');
  await waitPage(page, 2);
  await waitRendered(page, 2);
  await sleep(400);
  const p2 = await page.evaluate(() => {
    const h = document.querySelector('[data-page-host="2"]').getBoundingClientRect();
    const v = document.querySelector("[data-slide-viewport]").getBoundingClientRect();
    return { hw: h.width, hh: h.height, vw: v.width, vh: v.height };
  });
  const ar = p2.hw / p2.hh;
  check("D2 portrait page 2 keeps A4 aspect and fits in stage", Math.abs(ar - 595 / 842) < 0.02 && p2.hh <= p2.vh + 1, JSON.stringify(p2));
  await shot(page, `${OUT}/r09-mixed-portrait-page.png`);

  // same-name re-upload of a different file: write single.pdf under name mixed.pdf
  const { copyFileSync } = await import("node:fs");
  mkdirSync(path.resolve(OUT, "same"), { recursive: true });
  copyFileSync(path.resolve(OUT, "single.pdf"), path.resolve(OUT, "same/mixed.pdf"));
  await (await input()).uploadFile(path.resolve(OUT, "same/mixed.pdf"));
  await sleep(2000);
  s = await state(page);
  check("D3 same-name different file re-upload → 1 page shown, metrics updated", s.total === 1 && s.indicator === "1 / 1" && /1쪽/.test(s.fileInfo ?? ""), `indicator=${s.indicator} fileInfo=${s.fileInfo} metric=${s.metricPage}`);
  const btns = await page.evaluate(() => [document.querySelector('[data-action="prev"]').disabled, document.querySelector('[data-action="next"]').disabled]);
  check("D4 single page: prev/next disabled", btns[0] && btns[1], JSON.stringify(btns));
  await shot(page, `${OUT}/r10-single-page.png`);

  await (await input()).uploadFile(path.resolve(OUT, "encrypted.pdf"));
  await sleep(2500);
  s = await state(page);
  const errText = await page.evaluate(() => document.querySelector('[data-state="error"]')?.textContent ?? "");
  check("D5 encrypted PDF → Korean password error", /암호/.test(errText), `state=${s.state} text=${errText}`);
  await shot(page, `${OUT}/r11-encrypted.png`);

  // Drag & drop a PDF anywhere on the page (synthetic DataTransfer)
  const buf = (await import("node:fs")).readFileSync(path.resolve("fixtures/presentation.pdf")).toString("base64");
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "dropped.pdf", { type: "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector("main");
    for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, buf);
  await page.waitForFunction(() => document.querySelector("[data-file-name]")?.textContent === "dropped.pdf", { timeout: 5000 }).catch(() => {});
  await page.waitForSelector('[data-state="ready"]', { timeout: 15000 }).catch(() => {});
  s = await state(page);
  const overlay = await page.evaluate(() => !!document.querySelector(".fixed.inset-0.z-50"));
  check("D6 drag&drop PDF opens (12 pages), overlay hidden", s.total === 12 && !overlay, `${s.indicator} overlay=${overlay}`);
  // swipe after drop works
  const W = s.vp.w, cx = s.vp.x + W / 2, cy = s.vp.y + s.vp.h / 2;
  await waitRendered(page, 1);
  await touchDrag(cdp, cx + W * 0.3, cy, -W * 0.6, 0, { holdMs: 120 });
  s = await waitPage(page, 2);
  check("D7 swipe on dropped PDF → 2", s.page === 2, s.indicator);
  await shot(page, `${OUT}/r12-dropped.png`);
  const bad = consoleBad(logs).filter((l) => !/PasswordException|encrypted|암호/i.test(l));
  check("D8 no console errors beyond expected password failure", bad.length === 0, bad.slice(0, 3).join(" ; "));
  console.log("D logs:", logs.filter((l) => /warn|error/i.test(l)).slice(0, 8));
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
writeFileSync(`${OUT}/review-results.json`, JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} passed`);
