// Probe: while answering on 390×844, does the growing answer bubble stay above the fixed bottom bar,
// and can the user scroll to the end of it? Samples geometry every 3 s.
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-3/visual/current";
const seedB = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/visual/seed.json", "utf8"));
const qaDone = JSON.parse(readFileSync(`${G2}/SCREENS-B/session-after-qa-2min.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/answer-ko-16k.wav" });
const samples = [];
try {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res));
  }, { ...qaDone, id: "s_g3probe2", status: "qa", qa: qaDone.qa.slice(0, 1), setup: { ...qaDone.setup, qaMinutes: 3 }, resume: { phase: "qa", remainingSec: 140 } }, seedB.blobs);
  await page.goto("http://localhost:3000/qa?s=s_g3probe2", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("질의응답 이어 가기"), { timeout: 20000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질의응답 이어 가기")).click());
  await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 60000 });
  const geo = () => page.evaluate(() => {
    const s = document.getElementById("app-scroll"); const bar = document.querySelector(".app-bottom-bar");
    const ans = document.querySelector('[class*="scroll-mb-\\[calc"]'); const a = ans?.getBoundingClientRect(); const b = bar.getBoundingClientRect();
    return { scrollTop: Math.round(s.scrollTop), maxScroll: s.scrollHeight - s.clientHeight, ansBottom: Math.round(a?.bottom ?? 0), barTop: Math.round(b.top), hiddenPx: Math.max(0, Math.round((a?.bottom ?? 0) - b.top)), chars: ans?.innerText.length };
  });
  for (let i = 0; i < 6; i++) { await sleep(3000); samples.push({ t: (i + 1) * 3, ...(await geo()) }); }
  await shot(page, `/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-3/capture/04-review-probe2-live.png`);
  await page.evaluate(() => { const s = document.getElementById("app-scroll"); s.scrollTop = s.scrollHeight; });
  await sleep(400);
  samples.push({ t: "scrolled-to-end", ...(await geo()) });
  await shot(page, `/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-3/capture/04-review-probe2-scrolled-end.png`);
} finally {
  writeFileSync(`/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-3/capture/qa-probe2.json`, JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(samples));
  await browser.close();
}
