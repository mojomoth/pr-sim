// Deployed visual verifier: node capture-deployed.mjs <mobile|desktop>
// Captures landing (fresh), setup (fresh), history (empty + seeded like local 07-history) on BASE.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { seed as seedC } from "/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-C/seed.mjs";
const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2";
const BASE = "https://pr-sim-lake.vercel.app";
const [dev = "mobile"] = process.argv.slice(2);
const mobile = dev === "mobile";
const OUT = `/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/deployed/visual/out-${mobile ? "390x844" : "1440x900"}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = JSON.parse(readFileSync(`${G2}/SCREENS-C/session-with-report.json`, "utf8"));
const qaDone = JSON.parse(readFileSync(`${G2}/SCREENS-B/session-after-qa-2min.json`, "utf8"));
const res = { dev, base: BASE, net: [], screens: {} };

async function seedRaw(page, session, blobs) {
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("pr-sim", 1);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" }); if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  }, session, blobs);
}
const probe = (page) => page.evaluate(() => {
  const s = document.getElementById("app-scroll");
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const rr = (el) => el && (({ left, top, right, bottom, width, height }) => ({ left: Math.round(left), top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect());
  const small = [...document.querySelectorAll("button, a, input, [role=tab], [role=button], summary, label:has(input)")].filter(vis)
    .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, text: (el.getAttribute("aria-label") || el.textContent || el.type || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => (x.w < 44 || x.h < 44) && x.tag !== "INPUT" || (x.tag === "INPUT" && x.h < 24));
  const scr = document.querySelector(".app-screen"); const dev = document.querySelector(".device"); const bar = document.querySelector(".app-bottom-bar");
  const scs = scr && getComputedStyle(scr);
  return {
    url: location.pathname + location.search,
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflowX: document.body.scrollWidth - document.body.clientWidth,
    scrollOverflowX: s ? s.scrollWidth - s.clientWidth : null,
    wideEls: [...(s?.querySelectorAll("*") ?? [])].filter((e) => { const r = e.getBoundingClientRect(); const sr = s.getBoundingClientRect(); return r.width > 0 && (r.right > sr.right + 1 || r.left < sr.left - 1) && getComputedStyle(e).position !== "fixed"; }).slice(0, 8).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`),
    smallTargets: small, device: rr(dev), screen: rr(scr), scroll: rr(s), bar: rr(bar),
    deviceVisible: dev ? vis(dev) : null, screenRadius: scs?.borderRadius, screenOverflow: scs?.overflow,
    scrollH: s?.scrollHeight, clientH: s?.clientHeight,
    imgs: [...document.querySelectorAll("img, video, canvas")].filter(vis).map((e) => ({ tag: e.tagName, alt: e.alt, filter: getComputedStyle(e).filter, w: Math.round(e.getBoundingClientRect().width), complete: e.complete, nw: e.naturalWidth })),
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 600),
  };
});
const barOverlap = (page) => page.evaluate(async () => {
  const s = document.getElementById("app-scroll"); const bar = document.querySelector(".app-bottom-bar");
  if (!s || !bar) return null;
  s.scrollTop = s.scrollHeight; await new Promise((r) => setTimeout(r, 300));
  const bt = bar.getBoundingClientRect().top;
  const els = [...s.querySelectorAll("*")].filter((e) => !bar.contains(e) && e.children.length === 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).position !== "fixed");
  const last = els.reduce((a, e) => (e.getBoundingClientRect().bottom > (a?.getBoundingClientRect().bottom ?? -1) ? e : a), null);
  const lb = last?.getBoundingClientRect().bottom ?? 0; s.scrollTop = 0;
  return { lastContentBottom: Math.round(lb), barTop: Math.round(bt), hidden: lb > bt + 0.5, lastText: last?.textContent?.slice(0, 40) };
});
async function capture(page, name) {
  await sleep(800);
  await shot(page, `${OUT}/${name}.png`);
  const m = { probe: await probe(page), barOverlap: await barOverlap(page) };
  if (mobile) {
    const vp = page.viewport();
    const h = await page.evaluate(() => document.getElementById("app-scroll")?.scrollHeight ?? 844);
    if (h > vp.height) { await page.setViewport({ ...vp, height: Math.min(h + 2, 6000) }); await sleep(600); await shot(page, `${OUT}/${name}-full.png`); await page.setViewport(vp); await sleep(300); }
  }
  res.screens[name] = m;
  console.log(name, "docOX", m.probe.docOverflowX, "scrollOX", m.probe.scrollOverflowX, "device", JSON.stringify(m.probe.device));
}
const { browser, page, logs } = await launch({ mobile });
if (!mobile) await page.setViewport({ width: 1440, height: 900 });
page.on("response", (r) => { const u = new URL(r.url()); if (u.origin === BASE && (u.pathname.startsWith("/api/") || r.status() >= 400)) res.net.push(`${r.status()} ${r.request().method()} ${u.pathname}`); else if (r.status() >= 400) res.net.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(800);
  await capture(page, "01-landing");
  // fresh setup via landing CTA
  const clicked = await page.evaluate(() => { const a = [...document.querySelectorAll("a")].find((x) => x.getAttribute("href") === "/setup"); if (!a) return false; a.click(); return a.textContent.trim(); });
  res.landingCta = clicked;
  await page.waitForFunction(() => location.pathname === "/setup", { timeout: 20000 });
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 20000 }).catch(() => {});
  await sleep(1200);
  await capture(page, "02-setup-fresh");
  // history empty (direct)
  await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await capture(page, "07-history-empty");
  // history seeded as in local capture.mjs (done report + second done + one in progress)
  await seedC(page, report);
  await seedC(page, { ...report, id: "s_g3hist2", createdAt: "2026-11-10T10:00:00.000Z", setup: { ...report.setup, situation: "신규 서비스 투자 제안" } });
  await seedRaw(page, { ...qaDone, id: "s_g3hist3", status: "qa", qa: qaDone.qa.slice(0, 1), report: undefined, resume: { phase: "qa", remainingSec: 60 }, createdAt: "2026-11-08T10:00:00.000Z" }, {});
  await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await capture(page, "07-history");
} catch (e) {
  res.error = String(e); console.error(e);
  await shot(page, `${OUT}/99-error.png`).catch(() => {});
} finally {
  writeFileSync(`${OUT}/probe.json`, JSON.stringify(res, null, 2));
  writeFileSync(`${OUT}/console.log`, logs.join("\n"));
  await browser.close();
}
