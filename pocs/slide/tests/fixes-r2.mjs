// Fix round 2 verification (fix:slide) — run from pocs/: node slide/tests/fixes-r2.mjs
// Covers: pinch-in stuck at 0.8 (lift one-by-one AND both at once), trackpad wheel = 1 page/gesture
// (incl. back-to-back gestures, discrete shift+wheel notches), checkbox/prev/처음으로 focus + Space/→.
// Screenshots → .verify/slide/fix2/
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const OUT = ".verify/slide/fix2";
mkdirSync(OUT, { recursive: true });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const bad = (logs) => logs.filter((l) => /^\[(error|pageerror|requestfailed)\]|fake worker/i.test(l));
const st = (page) =>
  page.evaluate(() => {
    const r = document.querySelector("[data-slide-viewer]");
    const cur = r.querySelector(`[data-page-host="${r.dataset.page}"]`);
    const vp = r.querySelector("[data-slide-viewport]").getBoundingClientRect();
    const a = document.activeElement;
    return {
      page: +r.dataset.page,
      zoom: +r.dataset.zoom,
      t: cur?.style.transform ?? "",
      hostW: cur?.getBoundingClientRect().width,
      layoutW: cur?.offsetWidth,
      vp: { x: vp.x, y: vp.y, w: vp.width, h: vp.height },
      active: a?.hasAttribute("data-slide-viewer") ? "viewer" : `${a?.tagName}${a?.type ? ":" + a.type : ""}`,
      checked: document.querySelector('input[type="checkbox"]')?.checked,
    };
  });
const ready = (page) =>
  page.waitForFunction(() => {
    const r = document.querySelector("[data-slide-viewer]");
    return r?.dataset.state === "ready" && r.querySelector(`[data-page-host="${r.dataset.page}"]`)?.dataset.renderState === "done";
  }, { timeout: 30000 });

// ── P. Pinch-in below 1× (mobile, touch via CDP) ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide?sample=presentation`);
  await ready(page);
  await sleep(600);
  let s = await st(page);
  const cx = s.vp.x + s.vp.w / 2, cy = s.vp.y + s.vp.h / 2;
  const pinchIn = async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 100, y: cy, id: 1 }, { x: cx + 100, y: cy, id: 2 }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 100 + i * 6, y: cy, id: 1 }, { x: cx + 100 - i * 6, y: cy, id: 2 }] });
      await sleep(16);
    }
  };
  // P1: lift one finger, wait, lift the other
  await pinchIn();
  s = await st(page);
  const midScale = s.t;
  await shot(page, `${OUT}/p0-pinching-in.png`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: cx - 40, y: cy, id: 1 }] });
  await sleep(400);
  s = await st(page);
  check("P1 one finger lifted after pinch-in → already back to 1× (no transform)", s.zoom === 1 && !s.t && Math.abs(s.hostW - s.layoutW) < 1, `mid='${midScale}' now t='${s.t}' w=${s.hostW?.toFixed(1)}/${s.layoutW}`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  s = await st(page);
  check("P2 both lifted → 1×, page 1", s.zoom === 1 && !s.t && s.page === 1, `t='${s.t}' page=${s.page}`);
  await shot(page, `${OUT}/p2-after-pinch-in.png`);
  // P3: both fingers lifted in one touchEnd
  await pinchIn();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  s = await st(page);
  check("P3 pinch-in, both lifted at once → 1×", s.zoom === 1 && !s.t, `t='${s.t}'`);
  // P4: remaining finger then swipes → it must not swipe (gesture already consumed) and nothing breaks.
  // CDP: touchEnd with a point lifts THAT point; the remaining finger is id 2 (at cx+40).
  await pinchIn();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: cx - 40, y: cy, id: 1 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + 40 - i * 20, y: cy, id: 2 }] });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  s = await st(page);
  check("P4 leftover finger drag after pinch-in → stays page 1 at 1×", s.zoom === 1 && !s.t && s.page === 1, `page=${s.page} t='${s.t}'`);
  // P5: normal swipe still works afterwards
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx + 100, y: cy }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + 100 - i * 20, y: cy }] });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(500);
  s = await st(page);
  check("P5 swipe after pinch cycles → page 2", s.page === 2, `page=${s.page}`);
  // P6: pinch-out to zoom still works and stays zoomed (pan mode) after lifting one finger
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 40 - i * 8, y: cy, id: 1 }, { x: cx + 40 + i * 8, y: cy, id: 2 }] });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: cx - 120, y: cy, id: 1 }] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  s = await st(page);
  check("P6 pinch-out still zooms (>1.5×) and keeps zoom", s.zoom > 1.5 && /scale/.test(s.t), `zoom=${s.zoom}`);
  await shot(page, `${OUT}/p6-pinch-out.png`);
  check("P7 no console errors (pinch)", bad(logs).length === 0, bad(logs).join(" | "));
  await browser.close();
}

// ── W. Trackpad / wheel (desktop) ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/slide?sample=presentation`);
  await ready(page);
  await sleep(600);
  const fire = (deltas, gapMs = 16, opts = {}) =>
    page.evaluate(
      async (deltas, gapMs, opts) => {
        const el = document.querySelector("[data-slide-viewport]");
        for (const d of deltas) {
          el.dispatchEvent(new WheelEvent("wheel", { deltaX: d, deltaY: opts.dy ?? 0, deltaMode: opts.mode ?? 0, bubbles: true, cancelable: true }));
          await new Promise((r) => setTimeout(r, gapMs));
        }
      },
      deltas,
      gapMs,
      opts,
    );
  const macGesture = (sign = 1) => {
    const d = [];
    for (let i = 0; i < 9; i++) d.push(25 * sign);
    for (let v = 40; v >= 1; v *= 0.93) d.push(Math.round(v) * sign);
    return d; // 60 events ≈ 960ms (finger + momentum)
  };
  // W1: fresh pages (sizes still being discovered → effect re-subscribes mid-gesture)
  let before = (await st(page)).page;
  const t0 = Date.now();
  await fire(macGesture());
  const gestureMs = Date.now() - t0;
  await sleep(500);
  let s = await st(page);
  check("W1 one Mac trackpad gesture (60 ev, finger+momentum) on fresh deck → +1 page", s.page === before + 1, `${before}→${s.page} (${gestureMs}ms)`);
  // W2-W3: two gestures back-to-back with a 300ms pause → +2 total
  before = s.page;
  await fire(macGesture());
  await sleep(300);
  await fire(macGesture());
  await sleep(500);
  s = await st(page);
  check("W2 two gestures separated by a pause → +2 pages", s.page === before + 2, `${before}→${s.page}`);
  // W3: backwards gesture
  before = s.page;
  await fire(macGesture(-1));
  await sleep(500);
  s = await st(page);
  check("W3 backwards gesture → -1 page", s.page === before - 1, `${before}→${s.page}`);
  // W4: real wheel input (puppeteer mouse.wheel 12×30px, rapid) → +1
  const vp = s.vp;
  await page.mouse.move(vp.x + vp.w / 2, vp.y + vp.h / 2);
  before = s.page;
  for (let i = 0; i < 12; i++) await page.mouse.wheel({ deltaX: 30 });
  await sleep(500);
  s = await st(page);
  check("W4 puppeteer mouse.wheel 12×30px → +1 page", s.page === before + 1, `${before}→${s.page}`);
  // W5: discrete shift+wheel notches (100px, 350ms apart, like a mouse wheel) → one page each
  before = s.page;
  await fire([100, 100, 100], 350);
  await sleep(400);
  s = await st(page);
  check("W5 three separate wheel notches (350ms apart) → +3 pages", s.page === before + 3, `${before}→${s.page}`);
  // W6: line-mode deltas (deltaMode=1) also count
  before = s.page;
  await fire([-3, -3], 16, { mode: 1 });
  await sleep(500);
  s = await st(page);
  check("W6 line-mode wheel (deltaMode 1, -3 lines) → -1 page", s.page === before - 1, `${before}→${s.page}`);
  // W7: tiny short gesture below threshold → no turn
  before = s.page;
  await fire([10, 10, 10, 8, 5, 3]);
  await sleep(400);
  s = await st(page);
  check("W7 tiny horizontal nudge (46px) → no page turn", s.page === before, `${before}→${s.page}`);
  await shot(page, `${OUT}/w-desktop-after-wheel.png`);
  check("W8 no console errors (wheel)", bad(logs).length === 0, bad(logs).join(" | "));
  await browser.close();
}

// ── K. Keyboard focus after clicking page/viewer controls (desktop, global keyboard mode) ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/slide?sample=proposal`);
  await ready(page);
  await sleep(500);
  // K1: checkbox click → viewer remounts, focus lands on viewer, → turns page
  await page.click('input[type="checkbox"]');
  await ready(page);
  await sleep(300);
  let s = await st(page);
  const checkedAfterClick = s.checked;
  await page.keyboard.press("ArrowRight");
  await sleep(400);
  s = await st(page);
  check("K1 after clicking main-thread checkbox, → turns page", checkedAfterClick && s.page === 2, `page=${s.page} active=${s.active}`);
  await page.keyboard.press("Space");
  await sleep(400);
  s = await st(page);
  check("K2 …and Space advances (checkbox not re-toggled)", s.page === 3 && s.checked === true, `page=${s.page} checked=${s.checked}`);
  // K3: checkbox focused via keyboard (Tab) — → still turns page (checkbox is not a typing field), Space toggles it natively
  await page.focus('input[type="checkbox"]');
  await page.keyboard.press("ArrowRight");
  await sleep(400);
  s = await st(page);
  check("K3 checkbox focused, → turns page (not swallowed as typing)", s.page === 4, `page=${s.page} active=${s.active}`);
  // K4: 마지막으로 → 처음으로 → Space
  const btn = (txt) => page.evaluateHandle((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t), txt);
  await (await btn("마지막으로")).click();
  await sleep(400);
  await (await btn("처음으로")).click();
  await sleep(400);
  await page.keyboard.press("Space");
  await sleep(400);
  s = await st(page);
  check("K4 마지막으로 → 처음으로 → Space → 2 / N", s.page === 2, `page=${s.page} active=${s.active}`);
  await (await btn("마지막으로")).click();
  await sleep(400);
  s = await st(page);
  const last = s.page;
  await page.keyboard.press("ArrowLeft");
  await sleep(400);
  s = await st(page);
  check("K5 마지막으로 → ← goes to N-1", s.page === last - 1, `${last}→${s.page} active=${s.active}`);
  // K6: click viewer's prev button, then Space → next (not prev again)
  await page.click('[data-action="prev"]');
  await sleep(400);
  const afterPrev = (await st(page)).page;
  await page.keyboard.press("Space");
  await sleep(400);
  s = await st(page);
  check("K6 click ‹ prev button then Space → advances (+1)", s.page === afterPrev + 1 && s.active === "viewer", `${afterPrev}→${s.page} active=${s.active}`);
  // K7: click a thumbnail then Space → next
  await page.click('[data-thumb="5"]');
  await sleep(500);
  await page.keyboard.press("Space");
  await sleep(400);
  s = await st(page);
  check("K7 click thumbnail 5 then Space → 6", s.page === 6, `page=${s.page} active=${s.active}`);
  // K8: keyboard-only user: Tab to the next button and press Space → still presses the button (a11y kept)
  await page.focus('[data-action="next"]');
  await page.keyboard.press("Space");
  await sleep(400);
  s = await st(page);
  check("K8 keyboard-focused › button + Space → presses it once (+1), focus stays on button", s.page === 7 && s.active.startsWith("BUTTON"), `page=${s.page} active=${s.active}`);
  await shot(page, `${OUT}/k-desktop-keyboard.png`);
  check("K9 no console errors (keyboard)", bad(logs).length === 0, bad(logs).join(" | "));
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);
