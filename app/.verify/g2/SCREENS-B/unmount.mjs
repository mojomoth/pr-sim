// QaScreen unmount cleanup: leave /qa via browser Back while (a) the first question's TTS is loading,
// (b) the presenter is answering (mic open), (c) the judge is deciding (followup in flight).
// After leaving, no judge clip may play and no mic may stay open / be opened.
//   node seed-build.mjs && node unmount.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-B";
const BASE = "http://localhost:3000";
const AUDIO = "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
};
const seedData = JSON.parse(readFileSync(`${OUT}/seed.json`, "utf8"));
const rec0 = JSON.parse(readFileSync(`${OUT}/session-after-qa.json`, "utf8"));
Object.assign(rec0, { status: "qa", qa: [], resume: undefined });
rec0.setup.qaMinutes = 3;
const ID = rec0.id;

async function seed(page) {
  await page.evaluate(
    async (session, blobs) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("pr-sim", 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("sessions", { keyPath: "id" });
          r.result.createObjectStore("blobs");
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction(["sessions", "blobs"], "readwrite");
      tx.objectStore("sessions").put(session);
      for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
      await new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error))));
      db.close();
    },
    rec0,
    seedData.blobs,
  );
}
const clickText = (page, text) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.replace(/\s+/g, " ").trim().includes(text) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, text);

// Instrument: every <audio>.play() with a blob: src (judge clips; unlock uses a data: URL) and every
// getUserMedia call, stamped with the pathname; track live mic tracks.
const INSTRUMENT = () => {
  window.__ev = [];
  window.__tracks = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    if (String(this.src).startsWith("blob:")) window.__ev.push({ k: "play", path: location.pathname, t: performance.now() });
    return play.apply(this, a);
  };
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    window.__ev.push({ k: "gum", path: location.pathname, t: performance.now(), audio: !!c?.audio });
    const s = await gum(c);
    for (const tr of s.getAudioTracks()) window.__tracks.push(tr);
    return s;
  };
};
const state = (page) =>
  page.evaluate(() => ({
    path: location.pathname,
    ev: window.__ev,
    liveMic: window.__tracks.filter((t) => t.readyState === "live").length,
    audioPlaying: [...document.querySelectorAll("audio")].some((a) => !a.paused) || false,
  }));

async function scenario(name, { ttsDelayMs = 0, followupDelayMs = 0, leaveWhen }) {
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: `${AUDIO}/answer-ko-16k.wav` });
  const net = [];
  try {
    await page.evaluateOnNewDocument(INSTRUMENT);
    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      const u = req.url();
      const delay = u.includes("/api/tts") ? ttsDelayMs : u.includes("/api/questions/followup") ? followupDelayMs : 0;
      if (delay) {
        net.push(`delay ${delay}ms ${u.replace(BASE, "")}`);
        await sleep(delay);
      }
      req.continue().catch(() => {});
    });
    page.on("response", (r) => r.url().includes("/api/") && net.push(`${r.status()} ${r.url().replace(BASE, "")}`));
    page.on("requestfailed", (r) => r.url().includes("/api/") && net.push(`failed ${r.url().replace(BASE, "")} ${r.failure()?.errorText}`));
    await page.goto(`${BASE}/history`, { waitUntil: "domcontentloaded" });
    await seed(page);
    // client-side nav into /qa so browser Back is a SPA navigation (QA unmounts, document stays)
    await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" });
    const viaRouter = await page.evaluate((id) => (window.next?.router ? (window.next.router.push(`/qa?s=${id}`), true) : false), ID);
    if (!viaRouter) throw new Error("window.next.router missing");
    await page.waitForFunction(() => document.body.innerText.includes("질의응답 시작"), { timeout: 30000 });
    await sleep(800);
    await clickText(page, "질의응답 시작");
    await leaveWhen(page, net);
    await shot(page, `${OUT}/unmount-${name}-before-back.png`);
    const before = await state(page);
    const tBack = await page.evaluate(() => performance.now());
    await page.goBack({ waitUntil: "domcontentloaded" });
    await sleep(Math.max(ttsDelayMs, followupDelayMs) + 9000);
    const after = await state(page);
    await shot(page, `${OUT}/unmount-${name}-after-back.png`);
    const late = after.ev.filter((e) => e.t > tBack);
    check(`${name}: navigated away from /qa`, after.path !== "/qa", after.path);
    check(`${name}: no judge clip played after leaving`, !late.some((e) => e.k === "play") && !after.audioPlaying, { late, audioPlaying: after.audioPlaying });
    check(`${name}: no mic opened after leaving`, !late.some((e) => e.k === "gum"), late);
    check(`${name}: no live mic track left`, after.liveMic === 0, { before: before.liveMic, after: after.liveMic });
    if (name === "finalizing") check(`${name}: no follow-up decision delivered after leaving (none sent, or aborted)`, !net.some((l) => /^200 .*followup/.test(l)), net);
    if (name === "judging") check(`${name}: follow-up request was in flight and got cancelled`, net.some((l) => l.startsWith("failed") && l.includes("followup")) || !net.some((l) => /^200 .*followup/.test(l)), net);
    return { before, after, net, logs: logs.filter((l) => !/Download the React DevTools|HMR|Fast Refresh/.test(l)) };
  } finally {
    await browser.close();
  }
}

const out = {};
if (!process.env.ONLY || process.env.ONLY === "ttsLoading") out.ttsLoading = await scenario("tts-loading", {
  ttsDelayMs: 6000,
  leaveWhen: async (page) => {
    await page.waitForFunction(() => document.body.innerText.includes("질문 듣는 중"), { timeout: 15000 });
    await sleep(1000);
  },
});
if (!process.env.ONLY || process.env.ONLY === "answering") out.answering = await scenario("answering", {
  leaveWhen: async (page) => {
    await page.waitForFunction(() => document.body.innerText.includes("듣고 있어요"), { timeout: 60000 });
    await sleep(4000);
  },
});
if (!process.env.ONLY || process.env.ONLY === "judging") out.judging = await scenario("judging", {
  followupDelayMs: 5000,
  leaveWhen: async (page, net) => {
    await page.waitForFunction(() => document.body.innerText.includes("듣고 있어요"), { timeout: 60000 });
    await sleep(8000);
    await clickText(page, "답변 완료");
    for (let i = 0; i < 40 && !net.some((l) => l.includes("followup")); i++) await sleep(250);
    if (!net.some((l) => l.includes("followup"))) throw new Error("followup request not sent");
    await sleep(1000);
  },
});
if (!process.env.ONLY || process.env.ONLY === "finalizing") out.finalizing = await scenario("finalizing", {
  leaveWhen: async (page) => {
    await page.waitForFunction(() => document.body.innerText.includes("듣고 있어요"), { timeout: 60000 });
    await sleep(6000);
    await clickText(page, "답변 완료");
    await sleep(200);
  },
});
writeFileSync(`${OUT}/unmount${process.env.ONLY ? "-" + process.env.ONLY : ""}-results.json`, JSON.stringify({ results, out }, null, 2));
console.log(results.every((r) => r.ok) ? "ALL PASS" : "SOME FAILED");
