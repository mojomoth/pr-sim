import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [tag, base] of [["old-3000", "http://localhost:3000"], ["new-3218", "http://localhost:3218"]]) {
  const { browser, page } = await launch({ mobile: true });
  await page.goto(base + "/", { waitUntil: "networkidle0" }); await sleep(1500);
  await shot(page, `${import.meta.dirname}/landing-${tag}.png`);
  await page.goto(base + "/history", { waitUntil: "networkidle0" }); await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/" && a.getClientRects().length)?.click());
  await page.waitForFunction(() => location.pathname === "/"); await sleep(1500);
  const img = await page.evaluate(() => { const i = document.querySelector(".app-bleed img"); return { complete: i.complete, w: i.naturalWidth, rect: i.getBoundingClientRect().toJSON() }; });
  console.log(tag, "client-nav /history -> /", JSON.stringify(img));
  await shot(page, `${import.meta.dirname}/landing-via-nav-${tag}.png`);
  await browser.close();
}
