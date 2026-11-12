// Race test for useSentenceTranscriber: stop() while start() is still awaiting mic / token / socket.
// Counts live WebSockets and live mic tracks afterwards (must be 0), then checks a fresh start opens exactly one socket.
import { writeFileSync } from "node:fs";
import { shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { launchCore } from "./harness.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g2/CORE/round1";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launchCore({ fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/speech-ko-16k.wav" });

const counts = () =>
  page.evaluate(() => ({
    ws: window.__ws.filter((w) => w.readyState <= 1).length,
    wsTotal: window.__ws.length,
    tracks: window.__tracks.filter((t) => t.readyState === "live").length,
    status: window.T.stt?.status,
  }));

try {
  await page.evaluate(() => {
    window.__ws = [];
    const W = window.WebSocket;
    window.WebSocket = class extends W {
      constructor(...a) {
        super(...a);
        window.__ws.push(this);
        window.__onWs?.();
      }
    };
    window.__tracks = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (window.__gumDelay) await new Promise((r) => setTimeout(r, window.__gumDelay));
      const s = await gum(c);
      window.__tracks.push(...s.getTracks());
      return s;
    };
    const f = window.fetch.bind(window);
    window.fetch = async (u, o) => {
      if (window.__tokDelay && String(u).includes("/api/stt/token")) await new Promise((r) => setTimeout(r, window.__tokDelay));
      return f(u, o);
    };
  });
  await page.evaluate(async () => (await import("/__test/stt-race.tsx.src")).mount());
  await page.waitForFunction(() => window.T.sttStart, { timeout: 15000 });

  // A: stop() while mic permission is still pending
  await page.evaluate(() => {
    window.__gumDelay = 1500;
    void window.T.sttStart();
  });
  await sleep(300);
  await page.evaluate(() => window.T.sttStop());
  await sleep(3000);
  let c = await counts();
  check("A: stop during pending mic → mic track released, no socket", c.tracks === 0 && c.ws === 0 && c.wsTotal === 0 && c.status === "idle", c);
  await page.evaluate(() => (window.__gumDelay = 0));

  // B: stop() while the token request is in flight
  await page.evaluate(() => {
    window.__tokDelay = 1500;
    void window.T.sttStart();
  });
  await sleep(500);
  await page.evaluate(() => window.T.sttStop());
  await sleep(4000);
  c = await counts();
  check("B: stop during token fetch → no socket opened, mic released", c.ws === 0 && c.wsTotal === 0 && c.tracks === 0 && c.status === "idle", c);
  await page.evaluate(() => (window.__tokDelay = 0));

  // C: stop() right after the Live WebSocket is created (still connecting)
  await page.evaluate(() => {
    window.__onWs = () => {
      window.__onWs = null;
      setTimeout(() => void window.T.sttStop(), 0);
    };
    void window.T.sttStart();
  });
  await sleep(7000);
  c = await counts();
  check("C: stop while socket connecting → socket closed after open, mic released", c.ws === 0 && c.wsTotal === 1 && c.tracks === 0 && c.status === "idle", c);

  // D: fresh start after the race → exactly one open socket, stays one, no spurious reconnect
  await page.evaluate(() => void window.T.sttStart());
  await page.waitForFunction(() => ["listening", "error"].includes(window.T.stt?.status), { timeout: 15000 });
  await sleep(6000);
  c = await counts();
  const st = await page.evaluate(() => window.T.stt);
  check("D: next start → listening with exactly one live socket", st.status === "listening" && c.ws === 1 && c.wsTotal === 2 && c.tracks === 1 && !st.notice, { ...c, ...st });
  await shot(page, `${OUT}/stt-race-listening.png`);
  await page.evaluate(() => window.T.sttStop());
  await sleep(1500);
  c = await counts();
  check("D: stop → socket and mic released", c.ws === 0 && c.tracks === 0 && c.status === "idle", c);

  // E: rapid start/stop/start → only the last run's socket remains
  await page.evaluate(async () => {
    void window.T.sttStart();
    await new Promise((r) => setTimeout(r, 50));
    await window.T.sttStop();
    void window.T.sttStart();
  });
  await page.waitForFunction(() => ["listening", "error"].includes(window.T.stt?.status), { timeout: 15000 });
  await sleep(6000);
  c = await counts();
  check("E: start/stop/start → one live socket, listening", c.ws === 1 && c.tracks === 1 && c.status === "listening", c);
  await page.evaluate(() => window.T.sttStop());
  await sleep(1500);
  c = await counts();
  check("E: final stop → nothing left open", c.ws === 0 && c.tracks === 0 && c.status === "idle", c);
} catch (e) {
  check("run", false, String(e));
} finally {
  writeFileSync(`${OUT}/stt-race-results.json`, JSON.stringify({ results, logs }, null, 2));
  await browser.close();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
