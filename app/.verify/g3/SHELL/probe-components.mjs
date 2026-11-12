// Focused probes on SHELL components at 390×844: answer-bubble tail crop (Q&A seed, mic off),
// chip hit area (elementFromPoint 5px above/below the 32px pill), bottom bar background.
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/SHELL/current";
const seed = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/SCREENS-A/seed.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ mobile: true });
const out = {};
try {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res));
  }, { ...seed.session, id: "s_shellprobe" }, seed.blobs);
  await page.goto("http://localhost:3000/setup?s=s_shellprobe", { waitUntil: "networkidle2" });
  await sleep(1500);
  await page.evaluate(() => document.querySelector("[role=radiogroup]")?.scrollIntoView({ block: "center" })); await sleep(400);
  out.chips = await page.evaluate(() => [...document.querySelectorAll('[role=radiogroup] [role=radio]')].slice(0, 3).map((b) => {
    const r = b.getBoundingClientRect(); const cx = r.left + r.width / 2;
    const hit = (y) => b.contains(document.elementFromPoint(cx, y));
    return { text: b.textContent, h: Math.round(r.height), hitAbove5: hit(r.top - 5), hitBelow5: hit(r.bottom + 5), effectiveHitH: (() => { let t = 0; for (let y = r.top - 12; y <= r.bottom + 12; y++) if (hit(y)) t++; return t; })() };
  }));
  out.bottomBar = await page.evaluate(() => { const b = document.querySelector(".app-bottom-bar"); const cs = getComputedStyle(b); return { bg: cs.backgroundColor, backdrop: cs.backdropFilter }; });
  out.bodyWrap = await page.evaluate(() => { const cs = getComputedStyle(document.body); return { wordBreak: cs.wordBreak, overflowWrap: cs.overflowWrap }; });
} finally {
  writeFileSync(`${OUT}/probe-components.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
}
