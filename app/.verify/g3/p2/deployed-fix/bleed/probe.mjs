// node probe.mjs — paddingTop / header y on hard load and client nav, 1440x900 frame + 390x844 (and 390 with a simulated 47px notch).
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000", OUT = import.meta.dirname, TAG = process.env.TAG ?? "after";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (page) => page.evaluate(() => {
  const s = document.querySelector(".app-screen");
  const vis = (e) => e.getClientRects().length > 0;
  const h = [...document.querySelectorAll("#app-scroll header")].find(vis);
  return { path: location.pathname, paddingTop: getComputedStyle(s).paddingTop, headerY: h ? Math.round(h.getBoundingClientRect().top - s.getBoundingClientRect().top) : null,
    headerInnerY: h ? Math.round((h.querySelector("a,button,img,svg,h1") ?? h).getBoundingClientRect().top - s.getBoundingClientRect().top) : null,
    bleed: [...document.querySelectorAll(".app-bleed")].map((b) => (vis(b) ? "visible" : "hidden")) };
});
const click = (page, href) => page.evaluate((href) => [...document.querySelectorAll("a")].find((x) => x.getAttribute("href") === href && x.getClientRects().length).click(), href);
const out = {};
for (const [k, mobile, notch] of [["1440", false, false], ["390", true, false], ["390-notch47", true, true]]) {
  const { browser, page } = await launch({ mobile });
  if (!mobile) await page.setViewport({ width: 1440, height: 900 });
  if (notch) await page.evaluateOnNewDocument(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ":root{--safe-top:47px}"; document.head.append(s); }));
  const go = async (p) => { await page.goto(BASE + p, { waitUntil: "networkidle2" }); await sleep(800); };
  const nav = async (href, path) => { await click(page, href); await page.waitForFunction((p) => location.pathname === p, {}, path); await sleep(1500); };
  for (const p of ["/", "/setup", "/history"]) { await go(p); out[`${k} hard ${p}`] = await st(page); }
  await go("/"); await nav("/setup", "/setup"); out[`${k} / -> /setup (시작하기)`] = await st(page); await shot(page, `${OUT}/${TAG}-${k}-setup-via-cta.png`);
  await page.goBack(); await page.waitForFunction(() => location.pathname === "/"); await sleep(1200); out[`${k} /setup -> back /`] = await st(page); await shot(page, `${OUT}/${TAG}-${k}-landing-back.png`);
  await nav("/history", "/history"); out[`${k} / -> /history (연습 기록)`] = await st(page); await shot(page, `${OUT}/${TAG}-${k}-history-via-link.png`);
  await page.goBack(); await page.waitForFunction(() => location.pathname === "/"); await sleep(1200); out[`${k} /history -> back /`] = await st(page);
  await page.goForward(); await page.waitForFunction(() => location.pathname === "/history"); await sleep(1200); out[`${k} forward /history`] = await st(page);
  await browser.close();
}
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(34), v.paddingTop.padEnd(5), "headerY", v.headerY, "inner", v.headerInnerY, v.bleed.join(","));
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(out, null, 2));
