// Recheck: at 390×844 during a live presentation, are the judge name labels reachable above the fixed bottom bar
// once the transcript bubble wraps to two lines? Samples geometry every 2 s, scrolled to the end, and screenshots.
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/stage/shots";
const seedB = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/visual/seed.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/speech-ko-16k.wav" });
const samples = [];
try {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res));
  }, { ...seedB.session, id: "s_rc1labels", setup: { ...seedB.session.setup, presentationMinutes: 5 } }, seedB.blobs);
  await page.goto("http://localhost:3000/present?s=s_rc1labels", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("발표 시작")).click());
  const geo = () => page.evaluate(async () => {
    const s = document.getElementById("app-scroll"); const bar = document.querySelector(".app-bottom-bar");
    s.scrollTop = s.scrollHeight; await new Promise((r) => setTimeout(r, 250));
    const labels = [...document.querySelectorAll("section[aria-label='심사위원'] figcaption, section[aria-label='심사위원'] figure > :last-child")];
    const lb = Math.max(...labels.map((e) => e.getBoundingClientRect().bottom));
    const bubble = document.querySelector("#stt-h")?.closest("section")?.querySelector(".line-clamp-2");
    return { vh: innerHeight, scrollH: s.scrollHeight, clientH: s.clientHeight, scrollTop: Math.round(s.scrollTop), labelsBottom: Math.round(lb), barTop: Math.round(bar.getBoundingClientRect().top), hiddenPx: Math.max(0, Math.round(lb - bar.getBoundingClientRect().top)), bubbleH: Math.round(bubble?.getBoundingClientRect().height ?? 0) };
  });
  for (let i = 0; i < 10; i++) { await sleep(2000); samples.push({ t: (i + 1) * 2, ...(await geo()) }); }
  await shot(page, `${OUT}/03-presentation-mobile-scrolled-end.png`);
} finally {
  writeFileSync(`${OUT}/present-labels.json`, JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(samples));
  await browser.close();
}
