// G3 visual critic capture. Reuses G2 seed data (SCREENS-B/seed.json from seed-build.mjs,
// SCREENS-B/session-after-qa-2min.json, SCREENS-C/session-with-report.json + seed.mjs helpers).
//   node capture.mjs <static|present|qa> <mobile|desktop>
// mobile = 390×844 @2x (viewport + full-page), desktop = 1440×900 (mockup frame).
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { seed as seedC } from "/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-C/seed.mjs";

const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/stage/shots";
const BASE = "http://localhost:3000";
const AUDIO = "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio";
const [mode = "static", dev = "mobile"] = process.argv.slice(2);
const mobile = dev === "mobile";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seedB = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/visual/seed.json", "utf8"));
const report = JSON.parse(readFileSync(`${G2}/SCREENS-C/session-with-report.json`, "utf8"));
const qaDone = JSON.parse(readFileSync(`${G2}/SCREENS-B/session-after-qa-2min.json`, "utf8"));
const metrics = {};

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
const clickText = (page, text) => page.evaluate((text) => {
  const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.replace(/\s+/g, " ").trim().includes(text) && !x.disabled);
  if (!b) return false; b.click(); return true;
}, text);

/** Layout probes: horizontal overflow, small touch targets, bottom-bar overlap, frame containment. */
const probe = (page) => page.evaluate(() => {
  const s = document.getElementById("app-scroll");
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const small = [...document.querySelectorAll("button, a, input, [role=tab], [role=button], summary, label:has(input)")]
    .filter(vis)
    .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, text: (el.getAttribute("aria-label") || el.textContent || el.type || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => (x.w < 44 || x.h < 44) && x.tag !== "INPUT" || (x.tag === "INPUT" && x.h < 24));
  const bar = document.querySelector(".app-bottom-bar");
  const scr = document.querySelector(".app-screen");
  const dev = document.querySelector(".device");
  const rr = (el) => el && (({ left, top, right, bottom, width, height }) => ({ left: Math.round(left), top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect());
  const scs = scr && getComputedStyle(scr);
  return {
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollOverflowX: s ? s.scrollWidth - s.clientWidth : null,
    wideEls: [...(s?.querySelectorAll("*") ?? [])].filter((e) => { const r = e.getBoundingClientRect(); const sr = s.getBoundingClientRect(); return r.width > 0 && (r.right > sr.right + 1 || r.left < sr.left - 1) && getComputedStyle(e).position !== "fixed"; }).slice(0, 5).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`),
    smallTargets: small,
    bar: rr(bar), screen: rr(scr), device: rr(dev), scroll: rr(s),
    screenRadius: scs?.borderRadius, screenOverflow: scs?.overflow,
    scrollH: s?.scrollHeight, clientH: s?.clientHeight,
    imgs: [...document.querySelectorAll("img, video, canvas")].filter(vis).map((e) => ({ tag: e.tagName, filter: getComputedStyle(e).filter, parentFilter: getComputedStyle(e.parentElement).filter, w: Math.round(e.getBoundingClientRect().width) })),
  };
});
/** Bottom of the last in-flow content vs top of the fixed bar, scrolled to the end. */
const barOverlap = (page) => page.evaluate(async () => {
  const s = document.getElementById("app-scroll"); const bar = document.querySelector(".app-bottom-bar");
  if (!s || !bar) return null;
  s.scrollTop = s.scrollHeight; await new Promise((r) => setTimeout(r, 300));
  const bt = bar.getBoundingClientRect().top;
  const els = [...s.querySelectorAll("*")].filter((e) => !bar.contains(e) && e.children.length === 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).position !== "fixed");
  const last = els.reduce((a, e) => (e.getBoundingClientRect().bottom > (a?.getBoundingClientRect().bottom ?? -1) ? e : a), null);
  const lb = last?.getBoundingClientRect().bottom ?? 0;
  s.scrollTop = 0;
  return { lastContentBottom: Math.round(lb), barTop: Math.round(bt), hidden: lb > bt + 0.5, lastText: last?.textContent?.slice(0, 40) };
});

async function capture(page, name) {
  await sleep(600);
  const tag = mobile ? "mobile" : "desktop";
  await shot(page, `${OUT}/${name}-${tag}.png`);
  const m = { probe: await probe(page) };
  if (mobile) {
    m.barOverlap = await barOverlap(page);
    const vp = page.viewport();
    const h = await page.evaluate(() => document.getElementById("app-scroll")?.scrollHeight ?? 844);
    if (h > vp.height) {
      await page.setViewport({ ...vp, height: Math.min(h + 2, 6000) });
      await sleep(500);
      await shot(page, `${OUT}/${name}-mobile-full.png`);
      await page.setViewport(vp);
      await sleep(300);
    }
  }
  metrics[name] = m;
  console.log(name, "captured", JSON.stringify(m.probe.smallTargets).slice(0, 200));
}

const { browser, page, logs } = await launch({ mobile, fakeAudioWav: `${AUDIO}/${mode === "qa" ? "answer" : "speech"}-ko-16k.wav` });
if (!mobile) await page.setViewport({ width: 1440, height: 900 });
try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  if (mode === "static") {
    await sleep(800);
    await capture(page, "01-landing");
    // setup: draft with 3 judges (faces) + uploaded presentation PDF, proposal empty, 5/3 min
    const setup = { ...seedB.session, id: "s_g3setup", setup: { ...seedB.session.setup, situation: "친환경 패키징 사업 제안\n투자 심사위원을 설득하는 발표", presentationMinutes: 5, qaMinutes: 3 }, docs: { presentation: seedB.session.docs.presentation } };
    await seedRaw(page, setup, seedB.blobs);
    await page.goto(`${BASE}/setup?s=s_g3setup`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.querySelectorAll("img").length >= 3, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    await capture(page, "02-setup");
    // results + feedback
    await seedC(page, report);
    await page.goto(`${BASE}/result?s=${report.id}`, { waitUntil: "networkidle2" });
    await page.waitForSelector("[data-testid=total-score]", { timeout: 20000 });
    await sleep(1000);
    await capture(page, "05-results");
    await page.goto(`${BASE}/result?s=${report.id}&tab=feedback`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.body.innerText.includes("질문별 피드백"), { timeout: 20000 });
    await sleep(1500);
    await capture(page, "06-feedback");
    // history: done (report) + a second done + one in progress
    await seedC(page, { ...report, id: "s_g3hist2", createdAt: "2026-11-10T10:00:00.000Z", setup: { ...report.setup, situation: "신규 서비스 투자 제안" } });
    await seedRaw(page, { ...qaDone, id: "s_g3hist3", status: "qa", qa: qaDone.qa.slice(0, 1), report: undefined, resume: { phase: "qa", remainingSec: 60 }, createdAt: "2026-11-08T10:00:00.000Z" }, {});
    await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" });
    await sleep(1500);
    await capture(page, "07-history");
  }
  if (mode === "present") {
    await seedRaw(page, { ...seedB.session, id: "s_g3present", setup: { ...seedB.session.setup, presentationMinutes: 5 } }, seedB.blobs);
    await page.goto(`${BASE}/present?s=s_g3present`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await sleep(1500);
    await clickText(page, "발표 시작");
    await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 20000 }).catch(() => {});
    await sleep(9000);
    await page.click('[data-action="next"]').catch(() => {});
    await page.click('[data-action="next"]').catch(() => {});
    await sleep(6000);
    metrics.bubble = await page.evaluate(() => document.querySelector("#stt-h")?.parentElement?.parentElement?.innerText);
    await capture(page, "03-presentation");
  }
  if (mode === "qa") {
    await seedRaw(page, { ...qaDone, id: "s_g3qa", status: "qa", qa: qaDone.qa.slice(0, 1), setup: { ...qaDone.setup, qaMinutes: 3 }, resume: { phase: "qa", remainingSec: 140 } }, seedB.blobs);
    await page.goto(`${BASE}/qa?s=s_g3qa`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("질의응답 이어 가기"), { timeout: 20000 });
    await sleep(800);
    await clickText(page, "질의응답 이어 가기");
    await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 60000 }).catch(() => {});
    await sleep(12000);
    metrics.qaText = await page.evaluate(() => document.body.innerText.slice(0, 400));
    await capture(page, "04-review");
  }
} catch (e) {
  metrics.error = String(e);
  console.error(e);
  await shot(page, `${OUT}/99-error-${mode}-${dev}.png`).catch(() => {});
} finally {
  writeFileSync(`${OUT}/metrics-${mode}-${dev}.json`, JSON.stringify(metrics, null, 2));
  writeFileSync(`${OUT}/console-${mode}-${dev}.log`, logs.join("\n"));
  await browser.close();
}
