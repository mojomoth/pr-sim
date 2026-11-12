import { launch } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const { browser, page } = await launch({ mobile: true });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
const r = await page.evaluate(() => {
  const cs = getComputedStyle(document.body);
  const all = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
  const i = all.indexOf("word-break: keep-all");
  return { wb: cs.wordBreak, ow: cs.overflowWrap, near: all.slice(i - 300, i + 120), bodySel: [...all.matchAll(/(^|\n)\s*body[^{]*\{[^}]*\}/g)].map(m=>m[0]).slice(0,4), focus: all.slice(all.indexOf(":focus-visible {"), all.indexOf(":focus-visible {") + 150) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
