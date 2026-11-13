import { launch } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const { browser, page } = await launch({});
await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
console.log(await page.evaluate(() => { const r=[]; for (const sh of document.styleSheets) { try { for (const c of sh.cssRules) if (c.cssText.includes("app-bleed")) r.push(c.cssText); } catch {} } return r.join("\n"); }));
await browser.close();
