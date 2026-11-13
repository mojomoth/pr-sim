// node bleed-probe.mjs [BASE] — paddingTop / header y / hidden-bleed inline style, hard load + client nav, 1440x900 / 390x844 / 390 notch47.
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const BASE = process.argv[2] ?? "http://localhost:3000", OUT = import.meta.dirname, TAG = process.env.TAG ?? "dev";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (page) => page.evaluate(() => {
  const s = document.querySelector(".app-screen");
  const vis = (e) => e.getClientRects().length > 0;
  const h = [...document.querySelectorAll("#app-scroll header")].find(vis);
  const hb = h ? (h.querySelector("a,button,h1,svg,img,span") ?? h) : null;
  const sTop = s.getBoundingClientRect().top;
  return { path: location.pathname, paddingTop: getComputedStyle(s).paddingTop,
    appH: getComputedStyle(document.querySelector(".app-scroll")).getPropertyValue("--app-h").trim(),
    headerY: h ? Math.round(h.getBoundingClientRect().top - sTop) : null,
    headerContentY: hb ? Math.round(hb.getBoundingClientRect().top - sTop) : null,
    bleeds: [...document.querySelectorAll(".app-bleed")].map((b) => ({ visible: vis(b), style: b.getAttribute("style"), hidden: b.hidden,
      ancestorHidden: (() => { let p = b.parentElement; while (p && p.id !== "app-scroll") { if (getComputedStyle(p).display === "none") return p.tagName + "[" + p.getAttribute("style") + "]"; p = p.parentElement; } return null; })() })),
    scrollChildren: [...document.querySelector("#app-scroll").children].map((c) => `${c.tagName}.${(c.className || "").toString().split(" ")[0]} style=${c.getAttribute("style")}`) };
});
const click = (page, href) => page.evaluate((href) => { const a = [...document.querySelectorAll("a")].find((x) => x.getAttribute("href") === href && x.getClientRects().length); a.click(); return a.textContent.trim(); }, href);
const out = {};
for (const [k, mobile, notch] of [["1440", false, false], ["390", true, false], ["390-notch47", true, true]]) {
  const { browser, page } = await launch({ mobile });
  if (!mobile) await page.setViewport({ width: 1440, height: 900 });
  if (notch) await page.evaluateOnNewDocument(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ":root{--safe-top:47px}"; document.head.append(s); }));
  const go = async (p) => { await page.goto(BASE + p, { waitUntil: "networkidle2" }); await sleep(800); };
  const nav = async (href, path) => { const label = await click(page, href); await page.waitForFunction((p) => location.pathname === p, {}, path); await sleep(1500); return label; };
  const back = async (p) => { await page.goBack(); await page.waitForFunction((p) => location.pathname === p, {}, p); await sleep(1200); };
  for (const p of ["/", "/setup", "/history"]) { await go(p); out[`${k} hard ${p}`] = await st(page); }
  await go("/");
  let l = await nav("/setup", "/setup"); out[`${k} / -> /setup [${l}]`] = await st(page); await shot(page, `${OUT}/${TAG}-${k}-setup-via-nav.png`);
  await back("/"); out[`${k} back -> /`] = await st(page); await shot(page, `${OUT}/${TAG}-${k}-landing-back.png`);
  l = await nav("/history", "/history"); out[`${k} / -> /history [${l}]`] = await st(page); await shot(page, `${OUT}/${TAG}-${k}-history-via-nav.png`);
  await back("/"); out[`${k} back -> / (2)`] = await st(page);
  // client nav from a non-landing page back to / via an in-app link (if any)
  await go("/setup"); const hasHome = await page.evaluate(() => !![...document.querySelectorAll('a[href="/"]')].find((x) => x.getClientRects().length));
  if (hasHome) { l = await nav("/", "/"); out[`${k} /setup -> / link [${l}]`] = await st(page); l = await nav("/history", "/history"); out[`${k} then -> /history [${l}]`] = await st(page); }
  await browser.close();
}
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(44), v.paddingTop.padEnd(5), "headerY", String(v.headerY).padEnd(4), "content", String(v.headerContentY).padEnd(4), "app-h", v.appH.slice(0, 40).padEnd(40), JSON.stringify(v.bleeds));
writeFileSync(`${OUT}/${TAG}-bleed.json`, JSON.stringify(out, null, 2));
