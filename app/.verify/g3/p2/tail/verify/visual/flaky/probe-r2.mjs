// Tail verifier probe: node probe.mjs <setup|setup1|present|qa> <W> <H>
// Captures screenshots + geometry at an arbitrary mobile viewport (DPR 2). Reuses seed.json and the G2 Q&A session.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2";
const [mode, W = "320", H = "700"] = process.argv.slice(2);
const OUT = `/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/tail/verify/visual/flaky/r2`;
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const AUDIO = "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio";
const seedB = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));
const qaDone = JSON.parse(readFileSync(`${G2}/SCREENS-B/session-after-qa-2min.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = { mode, W: +W, H: +H, net: [] };

async function seedRaw(page, session, blobs) {
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("pr-sim", 1);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" }); if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  }, session, blobs);
}
const common = (page) => page.evaluate(() => {
  const s = document.getElementById("app-scroll");
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return {
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollOverflowX: s ? s.scrollWidth - s.clientWidth : null,
    wideEls: [...(s?.querySelectorAll("*") ?? [])].filter((e) => { const r = e.getBoundingClientRect(); const sr = s.getBoundingClientRect(); return r.width > 0 && (r.right > sr.right + 1 || r.left < sr.left - 1) && getComputedStyle(e).position !== "fixed"; }).slice(0, 8).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`),
    imgs: [...document.querySelectorAll("img, video, canvas")].filter(vis).map((e) => ({ tag: e.tagName, alt: e.alt, filter: getComputedStyle(e).filter, parentFilter: getComputedStyle(e.parentElement).filter, gpFilter: getComputedStyle(e.parentElement.parentElement).filter, w: Math.round(e.getBoundingClientRect().width) })),
  };
});
const R = (r) => ({ l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, r: Math.round(r.right * 10) / 10, b: Math.round(r.bottom * 10) / 10 });

const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: `${AUDIO}/${mode === "qa" ? "answer" : "speech"}-ko-16k.wav` });
await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on("response", (r) => { if (r.url().includes("/api/")) res.net.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
const tag = `${W}x${H}`;
try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  if (mode === "setup" || mode === "setup1") {
    // Two (setup) or all three (setup1 = 3) judges saved without a photo → shared face notice.
    const faceless = mode === "setup" ? 2 : 3;
    const judges = seedB.session.judges.map((j, i) => (i < faceless ? { ...j, imageKey: undefined, thumbKey: undefined } : j));
    const sid = `s_tail_${mode}_${W}`;
    await seedRaw(page, { ...seedB.session, id: sid, judges, setup: { ...seedB.session.setup, situation: "친환경 패키징 사업 제안\n투자 심사위원을 설득하는 발표", presentationMinutes: 5, qaMinutes: 3 }, docs: { presentation: seedB.session.docs.presentation } }, seedB.blobs);
    await page.goto(`${BASE}/setup?s=${sid}`, { waitUntil: "networkidle2" });
    await page.waitForSelector("[data-testid=face-outage]", { timeout: 20000 });
    await sleep(1500);
    await page.evaluate(() => document.querySelector("[data-testid=face-outage]").scrollIntoView({ block: "center" }));
    await sleep(400);
    await shot(page, `${OUT}/02-setup-${mode}-${tag}.png`);
    res.notice = await page.evaluate(() => {
      const n = document.querySelector("[data-testid=face-outage]");
      const p = n.querySelector("p"); const b = n.querySelector("button");
      const lines = Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight));
      return { text: p.textContent, lines, p: (({ left, right, top, bottom }) => ({ left, right, top, bottom }))(p.getBoundingClientRect()), btn: (({ left, right, top, bottom, width, height }) => ({ left, right, top, bottom, width, height }))(b.getBoundingClientRect()), btnText: b.textContent, overlap: p.getBoundingClientRect().right > b.getBoundingClientRect().left };
    });
    res.rowCaptions = await page.evaluate(() => [...document.querySelectorAll("[aria-label='심사위원 목록'] li")].map((li) => li.innerText.replace(/\s+/g, " ").trim()));
    res.bottomBar = await page.evaluate(() => document.querySelector(".app-bottom-bar")?.innerText);
    await page.evaluate(() => { const s = document.getElementById("app-scroll"); s.scrollTop = 0; });
    await sleep(300);
    const h = await page.evaluate(() => document.getElementById("app-scroll")?.scrollHeight ?? +H);
    await page.setViewport({ width: +W, height: Math.min(h + 2, 6000), deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(600);
    await shot(page, `${OUT}/02-setup-${mode}-${tag}-full.png`);
    await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(300);
  }
  if (mode === "present") {
    const sid = `s_tail_present_${W}`;
    await seedRaw(page, { ...seedB.session, id: sid, setup: { ...seedB.session.setup, presentationMinutes: 5 } }, seedB.blobs);
    await page.goto(`${BASE}/present?s=${sid}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await sleep(1500);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("발표 시작"))?.click());
    await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 20000 }).catch(() => {});
    await sleep(6000);
    for (let i = 0; i < 9; i++) await page.click('[data-action="next"]').catch(() => {}); // two-digit page "10 / 12"
    await sleep(3000);
    res.controls = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const els = { prev: q('[data-action="prev"]'), ind: q("[data-page-indicator]"), next: q('[data-action="next"]'), full: q('[data-action="fullscreen"]') };
      const cam = [...document.querySelectorAll("video")].map((v) => v.parentElement).find(Boolean);
      const row = els.prev.parentElement; const card = row.parentElement;
      const out = {}; for (const [k, e] of Object.entries(els)) out[k] = (({ left, right, top, bottom, width, height }) => ({ left, right, top, bottom, width, height }))(e.getBoundingClientRect());
      out.indText = els.ind.textContent; out.indScrollW = els.ind.scrollWidth; out.indClientW = els.ind.clientWidth;
      out.cam = cam && (({ left, right, top, bottom, width, height }) => ({ left, right, top, bottom, width, height }))(cam.getBoundingClientRect());
      out.row = (({ left, right, top, bottom, width }) => ({ left, right, top, bottom, width }))(row.getBoundingClientRect());
      out.rowScrollW = row.scrollWidth; out.rowClientW = row.clientWidth;
      const seq = [out.prev, out.ind, out.next, out.full];
      out.pairOverlap = seq.slice(1).map((r, i) => +(seq[i].right - r.left).toFixed(1)); // >0 = overlap
      out.camOverlap = out.cam ? seq.map((r) => +(r.right - out.cam.left).toFixed(1)).map((d, i) => (out.cam.top < seq[i].bottom && out.cam.bottom > seq[i].top ? d : null)) : null;
      return out;
    });
    await shot(page, `${OUT}/03-presentation-${tag}.png`);
    res.common = await common(page);
    await page.evaluate(() => { const s = document.getElementById("app-scroll"); s.scrollTop = s.scrollHeight; });
    await sleep(400);
    await shot(page, `${OUT}/03-presentation-${tag}-end.png`);
  }
  if (mode === "qa") {
    const sid = `s_tail_qa_flaky2`;
    await seedRaw(page, { ...qaDone, id: sid, status: "qa", qa: qaDone.qa.slice(0, 1), setup: { ...qaDone.setup, qaMinutes: 3 }, resume: { phase: "qa", remainingSec: 140 } }, seedB.blobs);
    await page.goto(`${BASE}/qa?s=${sid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("질의응답 이어 가기"), { timeout: 20000 });
    await sleep(800);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질의응답 이어 가기"))?.click());
    await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 60000 }).catch(() => {});
    const geo = () => page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질문 다시 듣기"));
      if (!btn) return { replay: false, body: document.body.innerText.slice(0, 300) };
      const card = btn.parentElement.querySelector(":scope > div");
      const label = card.querySelector(":scope > p");
      const range = document.createRange(); range.selectNodeContents(label);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const b = btn.getBoundingClientRect();
      // visible glyph box of the button (icon + text)
      const br = document.createRange(); br.selectNodeContents(btn); const bt = [...br.getClientRects()].filter((r) => r.width > 0);
      const btnInk = bt.length ? { l: Math.min(...bt.map((r) => r.left)), r: Math.max(...bt.map((r) => r.right)), t: Math.min(...bt.map((r) => r.top)), bb: Math.max(...bt.map((r) => r.bottom)) } : null;
      const hit = rects.filter((r) => r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom);
      const inkHit = btnInk ? rects.filter((r) => r.right > btnInk.l && r.left < btnInk.r && r.bottom > btnInk.t && r.top < btnInk.bb) : [];
      const s = document.getElementById("app-scroll"); const bar = document.querySelector(".app-bottom-bar");
      const ans = [...document.querySelectorAll("p")].find((p) => p.textContent.startsWith("내 답변"))?.parentElement;
      return {
        replay: true, labelText: label.textContent, voiceTag: label.textContent.includes("기기 음성"),
        deviceVoiceNote: document.body.innerText.includes("기기 음성으로 질문을 읽어 드려요"),
        labelLines: [...new Set(rects.map((r) => Math.round(r.top)))].length,
        labelRects: rects.map((r) => ({ l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) })),
        btn: { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }, btnInk,
        hitBox: hit.length, hitInk: inkHit.length,
        ansBottom: ans ? Math.round(ans.getBoundingClientRect().bottom) : null, barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
        scrollTop: s ? Math.round(s.scrollTop) : null, maxScroll: s ? s.scrollHeight - s.clientHeight : null,
      };
    });
    res.samples = [];
    for (let i = 0; i < 6; i++) { await sleep(2000); res.samples.push({ t: (i + 1) * 2, ...(await geo()) }); if (i === 4) await shot(page, `${OUT}/04-review-${tag}.png`); }
    res.common = await common(page);
    await page.evaluate(() => { const s = document.getElementById("app-scroll"); s.scrollTop = 0; });
    await sleep(500);
    res.top = await geo();
    await shot(page, `${OUT}/04-review-${tag}-top.png`);
  }
} catch (e) {
  res.error = String(e); console.error(e);
  await shot(page, `${OUT}/99-error-${mode}-${tag}.png`).catch(() => {});
} finally {
  writeFileSync(`${OUT}/probe-${mode}-${tag}.json`, JSON.stringify(res, null, 2));
  writeFileSync(`${OUT}/console-${mode}-${tag}.log`, logs.join("\n"));
  await browser.close();
}
