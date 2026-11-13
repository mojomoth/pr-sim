// 390 with a simulated 47px top inset (--safe-top override): the bleed rule must still zero padding only on the visible landing.
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const B = "http://localhost:3000", sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ mobile: true });
await page.setRequestInterception(true);
page.on("request", (r) => (r.url().includes("/api/judges") ? r.respond({ status: 503, body: "{}" }) : r.continue()));
await page.evaluateOnNewDocument(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ":root{--safe-top:47px !important}"; document.head.append(s); }));
const st = async (n) => { await sleep(1500); const v = await page.evaluate(() => { const s = document.querySelector(".app-screen"); const h = [...document.querySelectorAll("#app-scroll header")].find((e) => e.getClientRects().length); const b = [...document.querySelectorAll(".app-bleed")].find((e) => e.getClientRects().length); return { path: location.pathname, pt: getComputedStyle(s).paddingTop, hdrTop: Math.round(h.getBoundingClientRect().top), hdrContent: Math.round(h.querySelector("a,img,svg").getBoundingClientRect().top), bleedTop: b ? Math.round(b.getBoundingClientRect().top) : null }; }); console.log(n.padEnd(28), JSON.stringify(v)); await shot(page, `${import.meta.dirname}/notch47-${n.replace(/\W+/g, "_")}.png`); };
const tap = async (h) => { const b = await page.evaluate((h) => { const a = [...document.querySelectorAll("a")].find((x) => x.getAttribute("href") === h && x.getClientRects().length); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, h); await page.touchscreen.tap(b.x, b.y); await page.waitForFunction((p) => location.pathname === p, {}, h); };
await page.goto(B + "/", { waitUntil: "networkidle2" }); await st("hard root");
await tap("/setup"); await st("root-setup");
await tap("/"); await st("setup-root backbtn");
await tap("/history"); await st("root-history");
await page.goBack(); await st("history-root browserback");
await browser.close();
