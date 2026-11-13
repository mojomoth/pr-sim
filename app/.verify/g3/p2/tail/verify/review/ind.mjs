import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const V = "/Users/jyl/work/study/pr-sim/app/.verify";
const seedB = JSON.parse(readFileSync(`${V}/g3/p2/verify-4/visual/seed.json`, "utf8"));
const res = {};
const { browser, page } = await launch({ mobile: true });
try {
  for (const w of [320, 359, 360, 390]) {
    await page.setViewport({ width: w, height: 700, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
    await page.evaluate(async (session, blobs) => {
      const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
      const tx = db.transaction(["sessions", "blobs"], "readwrite");
      tx.objectStore("sessions").put(session);
      for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
      await new Promise((res) => (tx.oncomplete = res));
    }, { ...seedB.session, id: "s_rvind" }, seedB.blobs);
    await page.goto("http://localhost:3000/present?s=s_rvind", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    for (const txt of [null, "12 / 12", "28 / 30"]) {
      res[`${w}-${txt ?? "asis"}`] = await page.evaluate((txt) => {
        const ind = document.querySelector("[data-page-indicator]");
        if (txt) ind.textContent = txt;
        const row = ind.parentElement;
        const last = row.lastElementChild.getBoundingClientRect().right;
        const cam = document.querySelector("[data-slide-viewer] video").parentElement.getBoundingClientRect();
        const icon = row.lastElementChild.firstElementChild.getBoundingClientRect(); // drawn 32px circle
        return { ind: ind.textContent, indW: Math.round(ind.getBoundingClientRect().width * 10) / 10, hitRight: Math.round(last * 10) / 10, drawnRight: Math.round(icon.right * 10) / 10, camLeft: Math.round(cam.left * 10) / 10, camW: Math.round(cam.width), hitClear: last <= cam.left, drawnClear: icon.right <= cam.left, overflow: row.scrollWidth > row.clientWidth };
      }, txt);
    }
    if (w === 320) await shot(page, `${V}/g3/p2/tail/verify/review/present-320-28of30.png`);
  }
} finally { await browser.close(); }
writeFileSync(`${V}/g3/p2/tail/verify/review/indicator.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 1));
