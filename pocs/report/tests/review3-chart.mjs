// Review round 3: measure the per-minute rate bars vs the dashed 340 line (are bars to scale?).
import { launch, BASE } from "../../scripts/browser.mjs";
const { browser, page } = await launch({ mobile: true });
await page.goto(`${BASE}/report?session=${encodeURIComponent("sample:session-bad")}&view=detail&tab=speech`, { waitUntil: "networkidle2" });
await page.waitForSelector('[data-testid="speech-panel"]');
const r = await page.evaluate(() => {
  const box = document.querySelector('[role="img"][aria-label^="분 단위"]');
  const base = box.getBoundingClientRect().bottom;
  const line = box.querySelector("span.border-dashed").getBoundingClientRect().top;
  const bars = [...box.querySelectorAll("span.bg-ink")].map((b) => ({ h: b.getBoundingClientRect().height, style: b.style.height }));
  return { boxH: box.getBoundingClientRect().height, lineFromBottom: base - line, bars, label: box.getAttribute("aria-label") };
});
console.log(JSON.stringify(r));
await browser.close();
