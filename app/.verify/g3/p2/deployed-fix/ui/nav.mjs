// Independent verifier: .app-screen paddingTop + header y on hard loads and client navs (real taps), 1440x900 frame + 390x844.
// /api/judges is answered 503 so no model is called. node nav.mjs
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const BASE = "http://localhost:3000", OUT = import.meta.dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = (page) => page.evaluate(() => {
  const s = document.querySelector(".app-screen");
  const sr = s.getBoundingClientRect();
  const scale = sr.width / s.offsetWidth; // desktop frame is transform-scaled
  const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const h = [...document.querySelectorAll("#app-scroll header")].find(vis);
  const hr = h?.getBoundingClientRect();
  const first = h && [...h.querySelectorAll("a,button,img,svg")].find(vis);
  const bleed = [...document.querySelectorAll(".app-bleed")].find(vis);
  const img = bleed?.querySelector("img");
  const rel = (y) => Math.round(((y - sr.top) / scale) * 10) / 10;
  return {
    path: location.pathname,
    paddingTop: getComputedStyle(s).paddingTop,
    scale: Math.round(scale * 1000) / 1000,
    screenTopVp: Math.round(sr.top * 10) / 10,
    headerTopVp: hr ? Math.round(hr.top * 10) / 10 : null,
    headerTopInScreen: hr ? rel(hr.top) : null,
    headerContentTopInScreen: first ? rel(first.getBoundingClientRect().top) : null,
    bleedVisible: !!bleed,
    bleedTopInScreen: bleed ? rel(bleed.getBoundingClientRect().top) : null,
    heroImgTopInScreen: img ? rel(img.getBoundingClientRect().top) : null,
    heroImgBottomGap: img ? Math.round((sr.bottom - img.getBoundingClientRect().bottom) / scale) : null,
    bleedCount: document.querySelectorAll(".app-bleed").length,
    scrollTop: document.getElementById("app-scroll").scrollTop,
  };
});

// mean RGB of a 20x2 CSS-px strip just inside the screen's top edge (x 60..80 from the screen's left, clear of corners/island)
const topStrip = async (page, file) => {
  const r = await page.evaluate(() => { const b = document.querySelector(".app-screen").getBoundingClientRect(); const sc = b.width / document.querySelector(".app-screen").offsetWidth; return { x: b.left + 60 * sc, y: b.top + 1 * sc, w: 20 * sc, h: 2 * sc }; });
  const buf = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h }, encoding: "binary" });
  return { file, png: buf };
};

const tap = async (page, mobile, selFn, arg) => {
  const box = await page.evaluate((src, arg) => { const el = new Function("arg", src)(arg); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: (el.getAttribute("aria-label") || el.textContent).trim().slice(0, 20) }; }, selFn, arg);
  if (!box) throw new Error("tap target missing " + arg);
  await sleep(150);
  if (mobile) await page.touchscreen.tap(box.x, box.y); else await page.mouse.click(box.x, box.y);
  return box.t;
};
const linkTo = `return [...document.querySelectorAll("a")].find((a) => a.getAttribute("href") === arg && a.getClientRects().length && !a.closest('[style*="display: none"]'));`;

const out = {}, strips = [];
for (const [k, mobile] of [["1440", false], ["390", true]]) {
  const { browser, page, logs } = await launch({ mobile });
  if (!mobile) await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().includes("/api/judges") ? r.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "test" } }) }) : r.continue()));
  const waitPath = (p) => page.waitForFunction((p) => location.pathname === p, { timeout: 15000 }, p);
  const rec = async (name) => { await sleep(1500); out[`${k} ${name}`] = await state(page); const f = `${k}-${name.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}.png`; await shot(page, `${OUT}/${f}`); strips.push({ k, name, ...(await topStrip(page, f)) }); };
  const hard = async (p) => { await page.goto(BASE + p, { waitUntil: "networkidle2" }); await sleep(500); };

  for (const p of ["/", "/setup", "/history"]) { await hard(p); await rec(`hard ${p}`); }

  await hard("/"); await tap(page, mobile, linkTo, "/setup"); await waitPath("/setup"); await rec("nav root-setup tap 시작하기");
  await hard("/"); await tap(page, mobile, linkTo, "/history"); await waitPath("/history"); await rec("nav root-history tap 연습기록");

  // /setup -> / via in-app back button (Link href="/") and via browser back
  await hard("/"); await tap(page, mobile, linkTo, "/setup"); await waitPath("/setup"); await sleep(800);
  await tap(page, mobile, linkTo, "/"); await waitPath("/"); await rec("nav setup-root backbutton");
  await hard("/"); await tap(page, mobile, linkTo, "/setup"); await waitPath("/setup"); await sleep(800);
  await page.goBack(); await waitPath("/"); await rec("nav setup-root browserback");
  await hard("/setup"); await sleep(800); await tap(page, mobile, linkTo, "/"); await waitPath("/"); await rec("nav hardsetup-root backbutton");

  // / -> /setup -> / -> /history
  await hard("/"); await tap(page, mobile, linkTo, "/setup"); await waitPath("/setup"); await rec("chain1 setup");
  await tap(page, mobile, linkTo, "/"); await waitPath("/"); await rec("chain2 root");
  await tap(page, mobile, linkTo, "/history"); await waitPath("/history"); await rec("chain3 history");
  await page.goBack(); await waitPath("/"); await rec("chain4 back root");
  await page.goForward(); await waitPath("/history"); await rec("chain5 forward history");

  out[`${k} console errors`] = logs.filter((l) => /^\[(error|pageerror)\]/.test(l) && !/503|api\/judges/.test(l));
  await browser.close();
}

// decode strips with sharp-free approach: save and let python read them
const { mkdirSync } = await import("node:fs");
mkdirSync(`${OUT}/strips`, { recursive: true });
for (const s of strips) writeFileSync(`${OUT}/strips/${s.file}`, s.png);
for (const [n, v] of Object.entries(out)) {
  if (Array.isArray(v)) { console.log(n.padEnd(42), JSON.stringify(v)); continue; }
  console.log(n.padEnd(42), v.path.padEnd(9), "pt", v.paddingTop.padEnd(5), "hdrTop", String(v.headerTopInScreen).padEnd(5), "hdrContent", String(v.headerContentTopInScreen).padEnd(5), "bleed", v.bleedVisible ? `vis img@${v.heroImgTopInScreen} botGap ${v.heroImgBottomGap}` : "-", "bleedEls", v.bleedCount, "scroll", v.scrollTop);
}
writeFileSync(`${OUT}/nav.json`, JSON.stringify(out, null, 2));
