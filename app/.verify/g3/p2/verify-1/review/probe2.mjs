// review verifier: history/setup at narrow widths; face notice after reload. node probe2.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { seed as seedC } from "/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-C/seed.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/review";
const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2";
const BASE = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seedB = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/shell/seed.json", "utf8"));
const report = JSON.parse(readFileSync(`${G2}/SCREENS-C/session-with-report.json`, "utf8"));
async function seedRaw(page, session, blobs) {
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" }); if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); db.close();
  }, session, blobs);
}
const overflow = () => page.evaluate(() => {
  const s = document.getElementById("app-scroll");
  const bad = [...document.querySelectorAll("button, a")].filter((b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1).map((b) => ({ t: b.textContent.trim().slice(0, 24), sw: b.scrollWidth, cw: b.clientWidth, sh: b.scrollHeight, ch: b.clientHeight }));
  return { scrollOverflowX: s ? s.scrollWidth - s.clientWidth : null, overflowingButtons: bad.slice(0, 8) };
});
const out = {};
const { browser, page, logs } = await launch({ mobile: true });
try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await seedC(page, report);
  await seedRaw(page, { ...report, id: "s_rvprog", status: "presentation", report: undefined, resume: { phase: "presentation", remainingSec: 90 }, createdAt: "2026-11-08T10:00:00.000Z" }, {});
  for (const w of [320, 360, 390]) {
    await page.setViewport({ width: w, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" }); await sleep(1200);
    out[`history-${w}`] = await overflow();
    await shot(page, `${OUT}/history-${w}.png`);
  }
  // setup: two saved judges without photos (as after a failed generation + reload)
  const judges = seedB.session.judges.map((j, i) => (i < 2 ? { ...j, imageKey: undefined, thumbKey: undefined } : j));
  await seedRaw(page, { ...seedB.session, id: "s_rvsetup", status: "draft", judges, docs: { presentation: seedB.session.docs.presentation } }, seedB.blobs);
  for (const w of [320, 390]) {
    await page.setViewport({ width: w, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/setup?s=s_rvsetup`, { waitUntil: "networkidle2" }); await sleep(1500);
    out[`setup-${w}`] = { ...(await overflow()), notice: await page.evaluate(() => document.querySelector("[data-testid=face-outage]")?.innerText ?? null), url: page.url() };
    await shot(page, `${OUT}/setup-reload-${w}.png`);
  }
} catch (e) { out.error = String(e); }
finally { writeFileSync(`${OUT}/probe2.json`, JSON.stringify(out, null, 2)); writeFileSync(`${OUT}/console2.log`, logs.join("\n")); await browser.close(); }
console.log(JSON.stringify(out, null, 2));
