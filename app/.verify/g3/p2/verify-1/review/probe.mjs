// review verifier: slide height on short phones, score overflow at 320px. node probe.mjs
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
const out = {};
const { browser, page, logs } = await launch({ mobile: true });
try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await seedRaw(page, { ...seedB.session, id: "s_rvpresent", setup: { ...seedB.session.setup, presentationMinutes: 5 } }, seedB.blobs);
  for (const [w, h] of [[390, 844], [390, 664], [375, 667], [375, 553], [320, 568]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/present?s=s_rvpresent`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 }).catch(() => {});
    await sleep(1200);
    out[`present-${w}x${h}`] = await page.evaluate(() => {
      const v = document.querySelector("[data-slide-viewport]"); const c = v?.querySelector("canvas");
      const s = document.getElementById("app-scroll");
      return { appH: s?.clientHeight, viewport: v && { w: Math.round(v.getBoundingClientRect().width), h: Math.round(v.getBoundingClientRect().height) }, canvasH: c && Math.round(c.getBoundingClientRect().height), slideMaxH: v && getComputedStyle(v).maxHeight, scrollH: s?.scrollHeight };
    });
    await shot(page, `${OUT}/present-${w}x${h}.png`);
  }
  await seedC(page, { ...report, id: "s_rv100", report: { ...report.report, total: 100, overall: 100, score: 100 } });
  await seedC(page, report);
  for (const w of [320, 360]) {
    await page.setViewport({ width: w, height: 700, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/result?s=${report.id}`, { waitUntil: "networkidle2" });
    await page.waitForSelector("[data-testid=total-score]", { timeout: 20000 });
    await sleep(800);
    out[`result-${w}`] = await page.evaluate(() => {
      const t = document.querySelector("[data-testid=total-score]"); const p = t.parentElement; const sec = t.closest("section");
      // simulate a 100 score in place to measure width
      const before = { text: t.textContent, pW: Math.round(p.scrollWidth), secW: Math.round(sec.clientWidth) };
      t.textContent = "100";
      const after = { pRight: Math.round(p.getBoundingClientRect().left + p.scrollWidth), secInnerRight: Math.round(sec.getBoundingClientRect().right - 24), lastChildRight: Math.round(p.lastElementChild.getBoundingClientRect().right), secRight: Math.round(sec.getBoundingClientRect().right) };
      return { before, after100: after };
    });
    await shot(page, `${OUT}/result-${w}-score100.png`);
  }
} catch (e) { out.error = String(e); }
finally { writeFileSync(`${OUT}/probe.json`, JSON.stringify(out, null, 2)); writeFileSync(`${OUT}/console.log`, logs.join("\n")); await browser.close(); }
console.log(JSON.stringify(out, null, 2));
