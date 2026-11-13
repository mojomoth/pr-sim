// Independent verifier probe: slide control row vs camera inset (present, 320 & 390) and the Q&A label row vs
// the 질문 다시 듣기 button (qa, 320 & 390, with the device-voice tag injected into the label text).
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const V = "/Users/jyl/work/study/pr-sim/app/.verify";
const OUT = `${V}/g3/p2/tail/verify/review`;
const seedB = JSON.parse(readFileSync(`${V}/g3/p2/verify-4/visual/seed.json`, "utf8"));
const qaDone = JSON.parse(readFileSync(`${V}/g2/SCREENS-B/session-after-qa-2min.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const seed = (page, session) =>
  page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res));
  }, session, seedB.blobs);

for (const [w, h] of [[320, 640], [390, 844]]) {
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/answer-ko-16k.wav" });
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
    await seed(page, { ...seedB.session, id: "s_rvpres" });
    await seed(page, { ...qaDone, id: "s_rvqa", status: "qa", qa: qaDone.qa.slice(0, 1), setup: { ...qaDone.setup, qaMinutes: 3 }, resume: { phase: "qa", remainingSec: 140 } });
    // ── present ──
    await page.goto("http://localhost:3000/present?s=s_rvpres", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await sleep(800);
    out[`present-${w}`] = await page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width * 10) / 10 }; };
      const prev = document.querySelector('[data-action="prev"]');
      const row = prev.parentElement;
      const kids = [...row.children].map((k) => ({ tag: k.tagName, ...r(k) }));
      const video = document.querySelector("[data-slide-viewer] video")?.parentElement;
      const card = row.parentElement;
      const overlaps = [];
      for (let i = 0; i < kids.length - 1; i++) if (kids[i].r > kids[i + 1].l + 0.5) overlaps.push(i);
      const lastRight = Math.max(...kids.map((k) => k.r));
      return { vw: innerWidth, card: r(card), row: r(row), rowScrollW: row.scrollWidth, rowClientW: row.clientWidth, kids, cam: video ? r(video) : null, siblingOverlap: overlaps, controlsRight: lastRight, clearOfCam: video ? lastRight <= video.getBoundingClientRect().left : null, docScrollW: document.documentElement.scrollWidth };
    });
    await shot(page, `${OUT}/present-${w}.png`);
    // ── qa ──
    await page.goto("http://localhost:3000/qa?s=s_rvqa", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("질의응답 이어 가기"), { timeout: 20000 });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질의응답 이어 가기")).click());
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("질문 다시 듣기")), { timeout: 60000 });
    await sleep(1500);
    const measureQa = () => page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질문 다시 듣기"));
      const card = btn.parentElement;
      const p = card.querySelector("p");
      const range = document.createRange(); range.selectNodeContents(p);
      const rects = [...range.getClientRects()];
      const textRight = Math.max(...rects.map((x) => x.right));
      const bb = btn.getBoundingClientRect(); const pb = p.getBoundingClientRect();
      const lines = Math.round(pb.height / parseFloat(getComputedStyle(p).lineHeight));
      // overlap only matters for text lines vertically within the button box
      const hit = rects.some((x) => x.right > bb.left && x.bottom > bb.top && x.top < bb.bottom);
      return { vw: innerWidth, label: p.textContent, labelLines: lines, textRight: Math.round(textRight), btnLeft: Math.round(bb.left), btnTop: Math.round(bb.top), btnBottom: Math.round(bb.bottom), pTop: Math.round(pb.top), pBottom: Math.round(pb.bottom), textUnderButton: hit, btnW: Math.round(bb.width), docScrollW: document.documentElement.scrollWidth };
    });
    out[`qa-${w}-asis`] = await measureQa();
    // Inject the device-voice tag (what voiceTag renders) into the label's status, plus the longer 꼬리질문 label.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질문 다시 듣기"));
      const p = btn.parentElement.querySelector("p");
      p.textContent = "심사위원 질문 · 10 / 12 · 기기 음성";
    });
    await sleep(200);
    out[`qa-${w}-devicevoice`] = await measureQa();
    await shot(page, `${OUT}/qa-${w}-devicevoice.png`);
    out[`logs-${w}`] = logs.filter((l) => /error|pageerror/i.test(l)).slice(0, 10);
  } catch (e) {
    out[`error-${w}`] = String(e);
    await shot(page, `${OUT}/error-${w}.png`).catch(() => {});
  } finally {
    await browser.close();
  }
}
writeFileSync(`${OUT}/geo.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
