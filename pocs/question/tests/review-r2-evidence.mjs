// Review r2: open the first question bubble's evidence after replaying a saved run (mobile).
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/question/review/r2-mobile-evidence";
const { browser, page, logs } = await launch({ mobile: true });
await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
await page.evaluate(() => { const d = document.querySelector('[data-testid="replay"]'); d.open = true; d.dispatchEvent(new Event("toggle")); });
await page.waitForFunction(() => document.querySelectorAll("#replay-run option").length > 1, { timeout: 10000 });
await page.select("#replay-run", process.argv[2] ?? "r_mwdm0oyfl2hh8");
await page.click('[data-testid="replay-load"]');
await page.waitForSelector('[data-testid="start-qa"]', { timeout: 10000 });
const info = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('[data-testid="judge-questions"] details')];
  ds.slice(0, 2).forEach((d) => (d.open = true));
  ds[0]?.scrollIntoView({ block: "start" });
  return { n: ds.length, text: ds[0]?.innerText.slice(0, 600), links: [...(ds[0]?.querySelectorAll("a") ?? [])].map((a) => a.href) };
});
console.log(JSON.stringify(info, null, 1));
await new Promise((r) => setTimeout(r, 500));
await shot(page, `${OUT}/evidence.png`);
if (info.links[0]) { const r = await fetch(info.links[0]); console.log("link", r.status, r.headers.get("content-type")); }
console.log("errors", logs.filter((l) => /^\[(error|pageerror)\]/.test(l)));
await browser.close();
