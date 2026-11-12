// review:slide round 2 — trackpad momentum on a deck whose page sizes are all already known (isolates the 450ms lock)
import { launch, BASE } from "../../scripts/browser.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ mobile: false });
await page.goto(`${BASE}/slide?sample=presentation`);
await page.waitForSelector('[data-state="ready"]');
await sleep(1000);
for (let i = 0; i < 11; i++) { await page.keyboard.press("ArrowRight"); await sleep(250); }
await page.keyboard.press("Home");
await sleep(800);
const pg = () => page.evaluate(() => +document.querySelector("[data-slide-viewer]").dataset.page);
for (let run = 0; run < 2; run++) {
  const before = await pg();
  const deltas = []; for (let i = 0; i < 9; i++) deltas.push(25); for (let v = 40; v >= 1; v *= 0.93) deltas.push(Math.round(v));
  await page.evaluate(async (deltas) => {
    const el = document.querySelector("[data-slide-viewport]");
    for (const d of deltas) { el.dispatchEvent(new WheelEvent("wheel", { deltaX: d, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 16)); }
  }, deltas);
  await sleep(700);
  console.log(`sizes-known run ${run}: ${deltas.length} events ~${deltas.length * 16}ms → ${before}→${await pg()}`);
}
await browser.close();
