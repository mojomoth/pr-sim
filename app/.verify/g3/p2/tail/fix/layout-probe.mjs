// Items 1+2: presenter slide control row vs camera inset, and Q&A replay button vs question label row,
// measured at 320 and 390 widths. Usage: node layout-probe.mjs <tag>   (writes layout-<tag>.json + screenshots)
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const V4 = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-4/visual";
const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/tail/fix";
const tag = process.argv[2] ?? "run";
const seedB = JSON.parse(readFileSync(`${V4}/seed.json`, "utf8"));
const qaDone = JSON.parse(readFileSync(`${G2}/SCREENS-B/session-after-qa-2min.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = (page, session) => page.evaluate(async (session, blobs) => {
  const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
  const tx = db.transaction(["sessions", "blobs"], "readwrite");
  tx.objectStore("sessions").put(session);
  for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
  await new Promise((res) => (tx.oncomplete = res));
}, session, seedB.blobs);
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const out = {};
for (const width of [320, 390]) {
  const { browser, page } = await launch({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/answer-ko-16k.wav" });
  await page.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
    // ── present
    await seed(page, { ...seedB.session, id: "s_tailpresent", setup: { ...seedB.session.setup, presentationMinutes: 5 } });
    await page.goto("http://localhost:3000/present?s=s_tailpresent", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await sleep(1200);
    out[`present-${width}`] = await page.evaluate((ov) => {
      const overlap = new Function("return " + ov)();
      const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
      const row = document.querySelector('[data-action="prev"]').parentElement;
      const kids = [...row.children].map(r);
      const cam = r(document.querySelector('[data-slide-viewer] .aspect-\\[4\\/3\\]'));
      const pairs = []; for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) pairs.push(overlap(kids[i], kids[j]));
      return { row: r(row), rowPadR: getComputedStyle(row).paddingRight, children: kids.map((k) => ({ left: Math.round(k.left), right: Math.round(k.right), w: Math.round(k.width) })), cam: { left: Math.round(cam.left), right: Math.round(cam.right), top: Math.round(cam.top), bottom: Math.round(cam.bottom), w: Math.round(cam.width) },
        childOverlapPx2: Math.round(pairs.reduce((a, b) => a + b, 0)), camOverlapPx2: Math.round(kids.reduce((a, k) => a + overlap(k, cam), 0)), rowOverflow: Math.round(row.scrollWidth - row.clientWidth), lastRight: Math.round(kids.at(-1).right) };
    }, overlap.toString());
    await shot(page, `${OUT}/present-${width}-${tag}.png`);
    // ── qa (answering: replay button shown); the device-voice tag is added to the label like voiceTag does
    await seed(page, { ...qaDone, id: "s_tailqa", status: "qa", qa: qaDone.qa.slice(0, 1), setup: { ...qaDone.setup, qaMinutes: 3 }, resume: { phase: "qa", remainingSec: 140 } });
    await page.goto("http://localhost:3000/qa?s=s_tailqa", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("질의응답 이어 가기"), { timeout: 20000 });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질의응답 이어 가기")).click());
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("질문 다시 듣기")), { timeout: 60000 });
    out[`qa-${width}`] = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질문 다시 듣기"));
      const label = btn.parentElement.querySelector("p");
      // Worst case of the label: the longer kind label, two-digit counter, and the device-voice tag.
      if (label.firstChild?.nodeType === 3) label.firstChild.textContent = "심사위원 질문";
      const counter = label.querySelector(".tabular"); if (counter) counter.textContent = "10 / 12";
      if (!label.textContent.includes("기기 음성")) counter?.insertAdjacentText("afterend", " · 기기 음성");
      const measure = () => {
        const range = document.createRange(); range.selectNodeContents(label);
        const b = btn.getBoundingClientRect();
        const rects = [...range.getClientRects()].filter((x) => x.width > 0);
        const textRight = Math.max(...rects.map((x) => x.right));
        const hit = rects.some((x) => x.right > b.left && x.left < b.right && x.bottom > b.top && x.top < b.bottom);
        return { labelPadR: getComputedStyle(label).paddingRight, labelLines: Math.round(label.getBoundingClientRect().height / 20), textRight: Math.round(textRight), btnLeft: Math.round(b.left), btnTop: Math.round(b.top), btnBottom: Math.round(b.bottom), textUnderButton: hit };
      };
      const current = measure();
      label.style.paddingRight = "0px"; // = markup without the reserve (previous build)
      const withoutReserve = measure();
      label.style.paddingRight = "";
      return { label: label.textContent, current, withoutReserve };
    });
    await shot(page, `${OUT}/qa-${width}-${tag}.png`);
  } finally { await browser.close(); }
}
writeFileSync(`${OUT}/layout-${tag}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
