// Real /present screen: toggle the mic off while STT is still "연결 중" (socket connecting), then back on.
// Expects: no socket left open after the off-toggle, exactly one socket after re-enabling, no reconnect notice.
// Uses the SCREENS-B seed (read only).
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g2/CORE/round1";
const BASE = "http://localhost:3000";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seedData = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-B/seed.json", "utf8"));
const ID = `${seedData.session.id}-corerace`;
const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/speech-ko-16k.wav" });
const counts = () => page.evaluate(() => ({ ws: window.__ws.filter((w) => w.readyState <= 1).length, wsTotal: window.__ws.length, tracks: window.__tracks.filter((t) => t.kind === "audio" && t.readyState === "live").length }));
const clickText = (text) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.replace(/\s+/g, " ").trim().includes(text) && !x.disabled);
    b?.click();
    return !!b;
  }, text);
try {
  await page.evaluateOnNewDocument(() => {
    window.__ws = [];
    const W = window.WebSocket;
    window.WebSocket = class extends W {
      constructor(...a) {
        super(...a);
        if (String(a[0]).includes("generativelanguage")) window.__ws.push(this); else return;
        window.__onWs?.();
      }
    };
    window.__tracks = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await gum(c);
      window.__tracks.push(...s.getTracks());
      return s;
    };
  });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
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
    { ...seedData.session, id: ID, presentationMin: 3 },
    seedData.blobs,
  );
  await page.goto(`${BASE}/present?s=${ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
  await sleep(1000);
  // turn the mic off the moment the Live socket is created (status still 연결 중)
  await page.evaluate(() => {
    window.__onWs = () => {
      window.__onWs = null;
      setTimeout(() => [...document.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent.includes("마이크"))?.click(), 0);
    };
  });
  check("present: 발표 시작 clicked", await clickText("발표 시작"), null);
  await sleep(7000);
  let c = await counts();
  const micBtn = await page.evaluate(() => [...document.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent.includes("마이크"))?.textContent);
  check("present: mic off during 연결 중 → no socket left open, mic track stopped", c.ws === 0 && c.wsTotal === 1 && c.tracks === 0 && /꺼짐/.test(micBtn), { ...c, micBtn });
  await shot(page, `${OUT}/present-mic-off-while-connecting.png`);
  await clickText("마이크 꺼짐");
  await sleep(9000);
  c = await counts();
  const body = await page.evaluate(() => document.body.innerText);
  check("present: mic back on → exactly one live socket, no reconnect notice", c.ws === 1 && c.wsTotal === 2 && c.tracks === 1 && !body.includes("다시 연결하고 있어요"), c);
  await shot(page, `${OUT}/present-mic-on-again.png`);
} catch (e) {
  check("run", false, String(e));
} finally {
  writeFileSync(`${OUT}/present-race-results.json`, JSON.stringify({ results, logs: logs.filter((l) => !/Ephemeral token/.test(l)) }, null, 2));
  await browser.close();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
