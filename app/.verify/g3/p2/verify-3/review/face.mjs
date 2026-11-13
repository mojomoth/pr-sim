import { readFileSync } from "node:fs";
import { launch } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const seedB = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-2/visual/seed.json", "utf8"));
const { browser, page } = await launch({ mobile: true });
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
const s = seedB.session;
const session = { ...s, id: "s_v3face", status: "draft", createdAt: new Date().toISOString(), judges: s.judges.map((j, i) => i < 2 ? { ...j, imageKey: "", thumbKey: "" } : j), docs: { presentation: s.docs.presentation } };
await page.evaluate(async (session) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("sessions", { keyPath: "id" }); d.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction(["sessions"], "readwrite"); tx.objectStore("sessions").put(session);
  await new Promise((res) => { tx.oncomplete = res; }); db.close();
}, session);
const res = [];
for (const round of ["first-load", "reload"]) {
  if (round === "first-load") await page.goto("http://localhost:3000/setup?s=s_v3face", { waitUntil: "networkidle0" }); else await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1500));
  res.push(await page.evaluate((round) => {
    const n = document.querySelector("[data-testid=face-outage]");
    return { round, url: location.pathname + location.search, judges: document.querySelectorAll('[aria-label="심사위원 목록"] > li').length, notice: n?.innerText ?? null, rowErrors: [...document.querySelectorAll('[aria-label="심사위원 목록"] [role=alert]')].length, faceLinks: [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "얼굴 만들기").length };
  }, round));
}
await page.screenshot({ path: "face-after-reload.png" });
console.log(JSON.stringify(res, null, 1));
await browser.close();
