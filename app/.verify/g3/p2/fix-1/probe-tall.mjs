// fix-1 probe: Q&A hero vs sticky header while answering (mobile + desktop), present slide height on short phones.
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/fix-1";
const V1 = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual";
const seedB = JSON.parse(readFileSync(`${V1}/seed.json`, "utf8"));
const qaDone = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-B/session-after-qa-2min.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = "tall";
const out = {};
const { browser, page } = await launch({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/answer-ko-16k.wav" });
const seed = (session) => page.evaluate(async (session, blobs) => {
  const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
  const tx = db.transaction(["sessions", "blobs"], "readwrite");
  tx.objectStore("sessions").put(session);
  for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
  await new Promise((res) => (tx.oncomplete = res));
}, session, seedB.blobs);
try {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  await seed({ ...qaDone, id: "s_fix1qa", status: "qa", qa: qaDone.qa.slice(0, 1), setup: { ...qaDone.setup, qaMinutes: 3 }, resume: { phase: "qa", remainingSec: 140 } });
  await page.setViewport({ width: 390, height: 1100, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await page.goto("http://localhost:3000/qa?s=s_fix1qa", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("질의응답 이어 가기"), { timeout: 20000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질의응답 이어 가기")).click());
  await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 60000 });
  const geo = () => page.evaluate(() => {
    const s = document.getElementById("app-scroll"); const bar = document.querySelector(".app-bottom-bar");
    const head = document.querySelector(".sticky"); const img = document.querySelector('img[alt$="심사위원 얼굴"]');
    const hero = img?.parentElement?.parentElement; const ans = document.querySelector('[class*="scroll-mb-[calc"]');
    const r = (e) => e?.getBoundingClientRect();
    return { scrollTop: Math.round(s.scrollTop), maxScroll: s.scrollHeight - s.clientHeight, headBottom: Math.round(r(head).bottom), heroTop: Math.round(r(hero)?.top ?? -1), heroH: Math.round(r(hero)?.height ?? -1), heroClippedPx: Math.max(0, Math.round(r(head).bottom - (r(hero)?.top ?? 0))), compact: !!img?.closest(".rounded-full"), ansBottom: Math.round(r(ans)?.bottom ?? 0), barTop: Math.round(r(bar).top), ansHiddenPx: Math.max(0, Math.round((r(ans)?.bottom ?? 0) - r(bar).top)) };
  });
  out.qa = [];
  for (let i = 0; i < 4; i++) { await sleep(3000); out.qa.push({ t: (i + 1) * 3, ...(await geo()) }); }
  await shot(page, `${OUT}/04-review-${mode}.png`);
  if (mode === "mobile") {
    await seed({ ...seedB.session, id: "s_fix1present", setup: { ...seedB.session.setup, presentationMinutes: 5 } });
    out.present = {};
    for (const [w, h] of [[390, 844], [390, 664], [375, 667], [375, 553], [320, 568]]) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto("http://localhost:3000/present?s=s_fix1present", { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 }).catch(() => {});
      await sleep(1200);
      out.present[`${w}x${h}`] = await page.evaluate(() => {
        const v = document.querySelector("[data-slide-viewport]"); const c = v?.querySelector("canvas");
        return { viewportH: v && Math.round(v.getBoundingClientRect().height), canvasH: c && Math.round(c.getBoundingClientRect().height), slideMaxH: v && getComputedStyle(v).maxHeight };
      });
      await shot(page, `${OUT}/present-${w}x${h}.png`);
    }
  }
} catch (e) { out.error = String(e); }
finally { writeFileSync(`${OUT}/probe-${mode}.json`, JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1)); await browser.close(); }
