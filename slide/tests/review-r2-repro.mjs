// review:slide round 2 — focused repros: pinch-in stuck scale, realistic macOS trackpad momentum
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/slide/review";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (page) => page.evaluate(() => {
  const r = document.querySelector("[data-slide-viewer]");
  const hosts = [...r.querySelectorAll("[data-page-host]")].map((h) => `${h.dataset.pageHost}:${h.style.transform || "-"}`);
  const vp = r.querySelector("[data-slide-viewport]").getBoundingClientRect();
  return { page: +r.dataset.page, zoom: r.dataset.zoom, hosts, vp: { x: vp.x, y: vp.y, w: vp.width, h: vp.height } };
});
// 1) pinch-in (fingers lift one at a time, like real hands)
{
  const { browser, page } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await page.goto(`${BASE}/slide?sample=presentation`);
  await page.waitForSelector('[data-state="ready"]');
  await sleep(1200);
  let s = await st(page);
  const cx = s.vp.x + s.vp.w / 2, cy = s.vp.y + s.vp.h / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 100, y: cy, id: 1 }, { x: cx + 100, y: cy, id: 2 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 100 + i * 6, y: cy, id: 1 }, { x: cx + 100 - i * 6, y: cy, id: 2 }] });
    await sleep(16);
  }
  // lift finger 2 first, then finger 1
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: cx - 40, y: cy, id: 1 }] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(800);
  s = await st(page);
  console.log("after pinch-in, one-at-a-time lift:", JSON.stringify(s));
  await shot(page, `${OUT}/r2-repro-pinch-in-stuck.png`);
  // swipe to 2 and back to 1
  for (const dx of [-200, 200]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
    for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + (dx * i) / 10, y: cy }] }); await sleep(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(600);
  }
  s = await st(page);
  console.log("after swipe away and back:", JSON.stringify(s));
  await shot(page, `${OUT}/r2-repro-pinch-in-after-swipe.png`);
  await browser.close();
}
// 2) realistic macOS trackpad: finger phase ~150ms + momentum ~900ms decaying (16ms cadence)
{
  const { browser, page } = await launch({ mobile: false });
  await page.goto(`${BASE}/slide?sample=presentation`);
  await page.waitForSelector('[data-state="ready"]');
  await sleep(1200);
  const s0 = await st(page);
  await page.mouse.move(s0.vp.x + s0.vp.w / 2, s0.vp.y + s0.vp.h / 2);
  for (const profile of ["short", "normal"]) {
    const before = (await st(page)).page;
    const deltas = [];
    if (profile === "short") { for (let i = 0; i < 6; i++) deltas.push(12); for (let v = 14; v >= 1; v *= 0.86) deltas.push(Math.round(v)); }
    else { for (let i = 0; i < 9; i++) deltas.push(25); for (let v = 40; v >= 1; v *= 0.93) deltas.push(Math.round(v)); }
    const dur = deltas.length * 16;
    await page.evaluate(async (deltas) => {
      const el = document.querySelector("[data-slide-viewport]");
      const r = el.getBoundingClientRect();
      for (const d of deltas) {
        el.dispatchEvent(new WheelEvent("wheel", { deltaX: d, deltaY: 0, bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
        await new Promise((res) => setTimeout(res, 16));
      }
    }, deltas);
    await sleep(700);
    const after = (await st(page)).page;
    console.log(`trackpad ${profile}: ${deltas.length} events over ~${dur}ms, sum=${deltas.reduce((a, b) => a + b)}px → page ${before}→${after} (Δ${after - before})`);
    await sleep(500);
  }
  await browser.close();
}
