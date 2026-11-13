// Checks .app-screen padding-top (safe-top) on /setup and /history after client-side nav from landing vs hard load.
// node bleed-probe.mjs <base>
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const BASE = process.argv[2] ?? "https://pr-sim-lake.vercel.app";
const tag = BASE.includes("localhost") ? "local" : "deployed";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/deployed/visual/bleed";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (page) => page.evaluate(() => {
  const s = document.querySelector(".app-screen"); const b = [...document.querySelectorAll(".app-bleed")];
  const h = document.querySelector("#app-scroll header, header");
  return { path: location.pathname, padTop: getComputedStyle(s).paddingTop, bleedCount: b.length, bleedHidden: b.map((e) => { let x = e; while (x && x !== document.body) { if (getComputedStyle(x).display === "none" || x.hidden) return true; x = x.parentElement; } return false; }), headerTop: h && Math.round(h.getBoundingClientRect().top), screenTop: Math.round(s.getBoundingClientRect().top) };
});
const out = {};
for (const mobile of [false, true]) {
  const { browser, page, logs } = await launch({ mobile });
  if (!mobile) await page.setViewport({ width: 1440, height: 900 });
  const k = mobile ? "390" : "1440";
  await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" }); await sleep(800);
  out[`${k}-history-hard`] = await st(page);
  await page.goto(`${BASE}/setup`, { waitUntil: "networkidle2" }); await sleep(1500);
  out[`${k}-setup-hard`] = await st(page);
  await shot(page, `${OUT}/${tag}-${k}-setup-hard.png`);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" }); await sleep(800);
  out[`${k}-landing`] = await st(page);
  await page.evaluate(() => [...document.querySelectorAll("a")].find((x) => x.getAttribute("href") === "/setup").click());
  await page.waitForFunction(() => location.pathname === "/setup"); await sleep(2000);
  out[`${k}-setup-via-cta`] = await st(page);
  await shot(page, `${OUT}/${tag}-${k}-setup-via-cta.png`);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" }); await sleep(800);
  await page.evaluate(() => [...document.querySelectorAll("a")].find((x) => x.getAttribute("href") === "/history").click());
  await page.waitForFunction(() => location.pathname === "/history"); await sleep(2000);
  out[`${k}-history-via-link`] = await st(page);
  await shot(page, `${OUT}/${tag}-${k}-history-via-link.png`);
  await browser.close();
}
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(out, null, 2));
