// Reviewer: count collapsed citation chips (>6 pages rendered as "p.A–B") on key pages.
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ mobile: false });
for (const [doc, slug] of [["cb3e5a08f4107921", "주요-수치"], ["4fca1ca885eef124", "시장-규모"], ["cb3e5a08f4107921", "원가-구조"]]) {
  await page.goto(`${BASE}/wiki?doc=${doc}&tab=wiki&page=${encodeURIComponent(slug)}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const r = await page.evaluate(() => {
    const chips = [...document.querySelectorAll("article button")].map((b) => b.textContent.trim()).filter((t) => /^p\.\d+/.test(t));
    return { total: chips.length, ranges: chips.filter((t) => /–/.test(t)), sample: chips.filter((t) => /–/.test(t)).slice(0, 6) };
  });
  console.log(doc, slug, "chips", r.total, "range-chips", r.ranges.length, r.sample.join(" "));
  // click first range chip and see which page opens
  const opened = await page.evaluate(async () => {
    const b = [...document.querySelectorAll("article button")].find((b) => /^p\.\d+–\d+/.test(b.textContent.trim()));
    if (!b) return null;
    const row = b.closest("tr, li")?.textContent?.slice(0, 80);
    b.click();
    await new Promise((r) => setTimeout(r, 1200));
    return { chip: b.textContent, row, sheet: document.querySelector('[role="dialog"]')?.textContent?.slice(0, 40) };
  });
  console.log("  first range chip:", JSON.stringify(opened));
  if (slug === "주요-수치") await shot(page, ".verify/wiki/review/d-cites-range-chip.png");
}
await browser.close();
