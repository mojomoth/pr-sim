// node report/tests/review2-overflow.mjs — find text that overflows the mobile viewport on the 발표 분석 tab (BAD session)
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ mobile: true });
await page.goto(`${BASE}/report?session=sample%3Asession-bad&view=detail&tab=speech`, { waitUntil: "networkidle0" });
await sleep(1000);
const r = await page.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const rg = document.createRange();
    rg.selectNodeContents(n);
    const rc = rg.getBoundingClientRect();
    if (rc.right > W + 1) out.push({ right: Math.round(rc.right), top: Math.round(rc.top + scrollY), text: n.textContent.slice(0, 80), parent: n.parentElement.className.toString().slice(0, 80) });
  }
  const els = [...document.querySelectorAll("body *")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === "visible").slice(-5).map((e) => `${e.tagName}.${e.className.toString().slice(0, 80)} sw=${e.scrollWidth} cw=${e.clientWidth}`);
  return { W, sw: document.documentElement.scrollWidth, text: out.slice(0, 8), els };
});
console.log(JSON.stringify(r, null, 1));
if (r.text[0]) {
  await page.evaluate((y) => window.scrollTo(0, y - 200), r.text[0].top);
  await sleep(300);
  await shot(page, ".verify/report/review/r2m-overflow-bad-speech.png");
}
await browser.close();
