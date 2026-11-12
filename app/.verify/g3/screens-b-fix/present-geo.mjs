// Present screen geometry on mobile (390×844) and desktop frame (1440×900): judge tiles, bar, overflow.
//   node present-geo.mjs <tag>
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/screens-b-fix";
const tag = process.argv[2] ?? "after";
const seedB = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/screens-b-fix/seed.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
for (const dev of ["mobile", "desktop"]) {
  const { browser, page } = await launch({ mobile: dev === "mobile", fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/speech-ko-16k.wav" });
  if (dev === "desktop") await page.setViewport({ width: 1440, height: 900 });
  try {
    await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
    await page.evaluate(async (session, blobs) => {
      const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
      const tx = db.transaction(["sessions", "blobs"], "readwrite");
      tx.objectStore("sessions").put(session);
      for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
      await new Promise((res) => (tx.oncomplete = res));
    }, { ...seedB.session, id: "s_g3fixpresent", setup: { ...seedB.session.setup, presentationMinutes: 5 } }, seedB.blobs);
    await page.goto("http://localhost:3000/present?s=s_g3fixpresent", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await sleep(1200);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("발표 시작"))?.click());
    await sleep(6000);
    out[dev] = await page.evaluate(() => {
      const s = document.getElementById("app-scroll"); const bar = document.querySelector(".app-bottom-bar");
      const tiles = [...document.querySelectorAll('section[aria-label="심사위원"] figure')].map((f) => { const r = f.firstElementChild.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
      const sec = document.querySelector('section[aria-label="심사위원"]').getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      return { scrollH: s.scrollHeight, clientH: s.clientHeight, tiles, judgesLeft: Math.round(sec.left), judgesRight: Math.round(sec.right), judgesBottom: Math.round(sec.bottom), barTop: Math.round(b.top), gapToBar: Math.round(b.top - sec.bottom), timerLabel: document.querySelector(".sticky")?.innerText.split("\n").slice(0, 4) };
    });
    await shot(page, `${OUT}/03-present-${dev}-${tag}.png`);
  } finally { await browser.close(); }
}
writeFileSync(`${OUT}/present-geo-${tag}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
