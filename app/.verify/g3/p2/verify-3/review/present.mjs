import { readFileSync } from "node:fs";
import { launch } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const seedB = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-2/visual/seed.json", "utf8"));
const { browser, page } = await launch({ mobile: true });
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.evaluate(async (session, blobs) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("sessions", { keyPath: "id" }); d.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction(["sessions", "blobs"], "readwrite"); tx.objectStore("sessions").put(session);
  for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
  await new Promise((res) => { tx.oncomplete = res; }); db.close();
}, { ...seedB.session, id: "s_v3present", setup: { ...seedB.session.setup, presentationMinutes: 5 } }, seedB.blobs);
const out = {};
for (const [w, h] of [[320, 568], [360, 740], [390, 844]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto("http://localhost:3000/present?s=s_v3present", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  out[`${w}x${h}`] = await page.evaluate(() => {
    const rr = (el) => el && (({ left, right, top, bottom }) => ({ l: Math.round(left), r: Math.round(right), t: Math.round(top), b: Math.round(bottom) }))(el.getBoundingClientRect());
    const card = document.querySelector("[data-slide-viewer]");
    const cam = document.querySelector('[aria-label="내 카메라"]');
    return { card: rr(card), prev: rr(document.querySelector('[data-action=prev]')), ind: rr(document.querySelector('[data-page-indicator]')), next: rr(document.querySelector('[data-action=next]')), fs: rr(document.querySelector('[data-action=fullscreen]')), cam: rr(cam), docOverflowX: document.documentElement.scrollWidth - innerWidth, scrollOverflowX: (() => { const s = document.getElementById("app-scroll"); return s ? s.scrollWidth - s.clientWidth : null; })() };
  });
  await page.screenshot({ path: `present-${w}x${h}.png` });
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
