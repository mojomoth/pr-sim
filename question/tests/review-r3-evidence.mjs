// Review r3: expand a question's evidence on a replayed run, check p.N links resolve.
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launch({ mobile: true });
await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
await page.waitForFunction(() => document.querySelectorAll("textarea").length > 0, { timeout: 20000 });
await page.evaluate(() => { const d = document.querySelector('[data-testid="replay"]'); d.open = true; d.dispatchEvent(new Event("toggle")); });
await page.waitForFunction(() => document.querySelectorAll("#replay-run option").length > 1, { timeout: 10000 });
await sleep(500);
await page.evaluate(() => document.querySelector('[data-testid="replay-load"]').click());
await page.waitForFunction(() => !!document.querySelector('[data-testid="start-qa"]'), { timeout: 15000 });
await sleep(500);
const info = await page.evaluate(() => {
  const ds = [...document.querySelectorAll("details")].filter((x) => /근거 \d+개 ·/.test(x.querySelector("summary")?.textContent ?? ""));
  const d = ds[4]; d.open = true; d.scrollIntoView({ block: "start" });
  return { n: ds.length, text: d.innerText.slice(0, 600), links: [...d.querySelectorAll("a")].map((a) => a.href) };
});
await sleep(400);
await shot(page, ".verify/question/review/r3/evidence-mobile.png");
const st = [];
for (const l of info.links.slice(0, 3)) { const r = await fetch(l); st.push(`${r.status} ${r.headers.get("content-type")} ${l.replace(BASE, "")}`); }
console.log(JSON.stringify({ ...info, st }, null, 1), logs.filter((l) => /error/i.test(l)));
await browser.close();
