// Edge cases: short desktop window (falls back to full screen), wide-short, app-bleed opt-out, tall monitor cap.
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g2/SHELL";
const { browser, page } = await launch();
const m = () => { const s = document.getElementById("app-screen"), b = s.getBoundingClientRect(); return { vp: [innerWidth, innerHeight], frame: getComputedStyle(document.querySelector(".device")).transform, screen: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], padTop: getComputedStyle(s).paddingTop, layoutW: s.offsetWidth }; };
for (const [w, h] of [[1280, 650], [1920, 1200], [800, 720], [1440, 900]]) {
  await page.setViewport({ width: w, height: h });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle0" });
  console.log(JSON.stringify(await page.evaluate(m)));
  await shot(page, `${OUT}/edge-${w}x${h}.png`);
}
await page.evaluate(() => { const d = document.createElement("div"); d.className = "app-bleed"; d.style.cssText = "height:300px;background:#111;color:#fff;padding-top:var(--safe-top)"; d.textContent = "app-bleed"; document.getElementById("app-scroll").prepend(d); });
console.log("bleed", JSON.stringify(await page.evaluate(m)), await page.evaluate(() => getComputedStyle(document.getElementById("app-scroll")).getPropertyValue("--app-h")));
await shot(page, `${OUT}/edge-bleed.png`);
await browser.close();
