// Where is the judge face during answering at 320x700? (hero vs sticky header), scrolled top and at follow position.
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/tail/verify/visual/out320";
const [W = "320", H = "700"] = process.argv.slice(2);
const seedB = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));
const qaDone = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-B/session-after-qa-2min.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/answer-ko-16k.wav" });
await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const out = [];
try {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res));
  }, { ...qaDone, id: "s_tail_hero" + W, status: "qa", qa: qaDone.qa.slice(0, 1), setup: { ...qaDone.setup, qaMinutes: 3 }, resume: { phase: "qa", remainingSec: 140 } }, seedB.blobs);
  await page.goto(`http://localhost:3000/qa?s=s_tail_hero${W}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("질의응답 이어 가기"), { timeout: 20000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질의응답 이어 가기")).click());
  await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 60000 }).catch(() => {});
  const g = (t) => page.evaluate((t) => {
    const img = [...document.querySelectorAll("img")].find((i) => i.alt.includes("심사위원 얼굴"));
    const s = document.getElementById("app-scroll");
    const head = s.querySelector(".sticky");
    const r = img?.getBoundingClientRect(); const h = head.getBoundingClientRect();
    return { t, scrollTop: Math.round(s.scrollTop), img: r && { t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }, headBottom: Math.round(h.bottom), visiblePx: r ? Math.max(0, Math.round(r.bottom - Math.max(r.top, h.bottom))) : 0, stage: document.body.innerText.includes("음성 인식 중") ? "answering" : "other" };
  }, t);
  for (let i = 0; i < 12; i++) { await sleep(1000); out.push(await g(i + 1)); if (i === 1) await shot(page, `${OUT}/04-review-${W}x${H}-early.png`); }
  await page.evaluate(() => { document.getElementById("app-scroll").scrollTop = 0; });
  await sleep(150);
  out.push(await g("forced-top"));
  await shot(page, `${OUT}/04-review-${W}x${H}-forced-top.png`);
} finally {
  writeFileSync(`${OUT}/qa-hero-${W}x${H}.json`, JSON.stringify(out, null, 2));
  console.log(out.map((o) => JSON.stringify(o)).join("\n"));
  await browser.close();
}
