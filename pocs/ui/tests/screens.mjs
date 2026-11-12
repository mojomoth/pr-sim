// Screenshot every /ui route at 390x844 (viewport + fullPage) and 1280x860.
// Run from pocs/: node ui/tests/screens.mjs [route-filter]
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const ROUTES = ["ui", "ui/setup", "ui/presentation", "ui/review", "ui/results", "ui/feedback", "ui/history", "ui/screens"];
const filter = process.argv[2];
const out = ".verify/ui";
const problems = [];

for (const mobile of [true, false]) {
  const { browser, page, logs } = await launch({ mobile });
  for (const r of ROUTES.filter((x) => !filter || x.includes(filter))) {
    logs.length = 0;
    const t0 = Date.now();
    await page.goto(`${BASE}/${r}`, { waitUntil: "networkidle0" });
    await new Promise((res) => setTimeout(res, r.includes("presentation") || r.includes("review") ? 3500 : 800));
    const name = r.replace(/\//g, "_");
    const tag = mobile ? "m" : "d";
    await shot(page, `${out}/${name}.${tag}.png`);
    if (mobile) {
      await shot(page, `${out}/${name}.${tag}.full.png`, { fullPage: true });
      // What a user sees after scrolling to the end (fixed bottom bar in place).
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await new Promise((res) => setTimeout(res, 300));
      await shot(page, `${out}/${name}.${tag}.bottom.png`);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const errs = logs.filter((l) => /\[(error|pageerror)\]/.test(l) || /requestfailed/.test(l));
    console.log(`${tag} /${r} ${Date.now() - t0}ms overflowX=${overflowX} errors=${errs.length}`);
    if (errs.length || overflowX) problems.push({ r, tag, overflowX, errs });
  }
  await browser.close();
}
if (problems.length) {
  console.log(JSON.stringify(problems, null, 2));
  process.exitCode = 1;
}
