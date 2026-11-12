// Reviewer r3: slide keyboard focus ring + arrows after focusing the slide. Run from pocs/.
import { launch, BASE } from "../../scripts/browser.mjs";
const { browser, page } = await launch({ mobile: false });
await page.goto(BASE + "/ui/presentation", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2500));
let info = "";
for (let i = 0; i < 12; i++) {
  await page.keyboard.press("Tab");
  info = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return `${a.getAttribute("aria-label") || a.textContent.trim().slice(0, 15)} | outline=${cs.outlineStyle} ${cs.outlineWidth} | shadow=${cs.boxShadow}`; });
  if (info.startsWith("발표 슬라이드")) break;
}
console.log("focused:", info);
await page.keyboard.press("ArrowRight");
await new Promise((r) => setTimeout(r, 600));
console.log("counter:", await page.$eval('[data-testid="slide-counter"]', (e) => e.textContent));
await browser.close();
