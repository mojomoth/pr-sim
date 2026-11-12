import { launch, shot, BASE } from "../../scripts/browser.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launch({ mobile: true });
await page.goto(`${BASE}/wiki?doc=cb3e5a08f4107921&tab=wiki&page=주요-수치`, { waitUntil: "networkidle0" });
await sleep(2000);
const info = await page.evaluate(() => { const a = document.querySelector("article"); const t = document.querySelector("article table"); return { articleTop: a?.getBoundingClientRect().top + scrollY, docH: document.documentElement.scrollHeight, table: t ? { w: t.getBoundingClientRect().width, pov: getComputedStyle(t.parentElement).overflowX } : null }; });
console.log(JSON.stringify(info));
await shot(page, ".verify/wiki/review/m-08-numbers-full.png", { fullPage: true });
await page.evaluate(() => document.querySelector("article table")?.scrollIntoView());
await sleep(500);
await shot(page, ".verify/wiki/review/m-09-table.png");
// presentation doc query: deck SOM
await page.goto(`${BASE}/wiki?doc=b074e9bd3e49c31f&tab=wiki&page=overview`, { waitUntil: "networkidle0" });
await sleep(1500);
await page.evaluate(() => document.querySelector("article")?.scrollIntoView());
await shot(page, ".verify/wiki/review/m-10-deck-overview.png");
console.log(logs.filter(l=>!/\[(log|info|debug)\]/.test(l)));
await browser.close();
