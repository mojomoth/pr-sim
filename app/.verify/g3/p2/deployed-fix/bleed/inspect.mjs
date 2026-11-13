import { launch } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const { browser, page } = await launch({});
await page.setViewport({ width: 1440, height: 900 });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
await new Promise(r=>setTimeout(r,800));
await page.evaluate(() => [...document.querySelectorAll("a")].find((x) => x.getAttribute("href") === "/setup").click());
await page.waitForFunction(() => location.pathname === "/setup"); await new Promise(r=>setTimeout(r,2000));
console.log(await page.evaluate(() => {
  const out = [];
  let x = document.querySelector(".app-bleed");
  while (x && x.id !== "app-scroll") { out.push({ tag: x.tagName, cls: x.className.slice(0,40), hidden: x.hidden, style: x.getAttribute("style") }); x = x.parentElement; }
  out.push({ scrollChildren: [...document.getElementById("app-scroll").children].map(c => ({ tag: c.tagName, cls: c.className.slice(0,40), style: c.getAttribute("style"), hidden: c.hidden })) });
  return JSON.stringify(out, null, 1);
}));
await browser.close();
