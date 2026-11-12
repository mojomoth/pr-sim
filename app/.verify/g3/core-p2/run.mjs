// G3 CORE P2 checks, on the real dev server (http://localhost:3000) through the G2 CORE harness
// (CORE modules transpiled on the fly, same origin so /api/stt/token and /worklets are real).
//   node run.mjs storage   → platform.storage.deleteBlob + features/session/db deleteBlob
//   node run.mjs fake      → useSentenceTranscriber with a scripted Live socket: t = start of each sentence, in spoken order
//   node run.mjs live      → same hook with the REAL Gemini Live socket, answer-ko wav as the mic
import { writeFileSync } from "node:fs";
import { shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { launchCore } from "../../g2/CORE/harness.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/core-p2";
const AUDIO = "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio";
const mode = process.argv[2] ?? "storage";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mounts the hook (plain React.createElement, no test file) and renders the sentences on the page.
const MOUNT = async () => {
  const React = (await import("/__cjs/react")).default;
  const { createRoot } = await import("/__cjs/react-dom/client");
  const { useSentenceTranscriber } = await import("/__core/features/stt/useSentenceTranscriber.ts");
  window.T = { got: [] };
  function Stt() {
    const t = useSentenceTranscriber({ phase: "qa", onSentence: (x) => window.T.got.push(x) });
    React.useEffect(() => {
      window.T.status = t.status;
      window.T.error = t.error;
      window.T.start = t.start;
      window.T.stop = t.stop;
    });
    return React.createElement(
      "div",
      { style: { position: "fixed", inset: 0, zIndex: 9999, background: "#fff", color: "#111", font: "14px/1.5 system-ui", padding: 16, overflow: "auto" } },
      React.createElement("h3", null, `useSentenceTranscriber — ${window.__mode} — ${t.status} ${t.error ?? ""}`),
      React.createElement("p", null, `partial: ${t.partialSentences.join(" | ")}`),
      React.createElement(
        "ol",
        null,
        t.sentences.map((s) => React.createElement("li", { key: s.id }, `t=${s.t.toFixed(1)}s  ${s.text}`)),
      ),
    );
  }
  const el = document.createElement("div");
  document.body.prepend(el);
  createRoot(el).render(React.createElement(Stt));
};

if (mode === "storage") {
  const { browser, page, logs } = await launchCore();
  try {
    const r = await page.evaluate(async () => {
      const { platform } = await import("/__core/platform/index.ts");
      const db = await import("/__core/features/session/db.ts");
      const s = platform.storage;
      const blob = (t) => new Blob([t], { type: "text/plain" });
      await s.putBlob("test:g3:a", blob("a"));
      await s.putBlob("test:g3:b", blob("b"));
      const before = [!!(await s.getBlob("test:g3:a")), !!(await s.getBlob("test:g3:b"))];
      await s.deleteBlob("test:g3:a");
      const afterPlatform = [!!(await s.getBlob("test:g3:a")), !!(await s.getBlob("test:g3:b"))];
      await db.deleteBlob("test:g3:b"); // detached re-export from features/session/db
      const afterDb = [!!(await s.getBlob("test:g3:a")), !!(await s.getBlob("test:g3:b"))];
      let missingOk = true;
      try {
        await s.deleteBlob("test:g3:never-existed");
      } catch {
        missingOk = false;
      }
      const sessionsUntouched = (await s.listSessions()).length;
      document.body.insertAdjacentHTML(
        "afterbegin",
        `<pre style="position:fixed;inset:0;z-index:9999;background:#fff;color:#111;padding:16px;font:14px/1.5 monospace">platform.storage.deleteBlob (IndexedDB "pr-sim" / blobs)\nbefore      a,b = ${before}\ndeleteBlob(a)   → ${afterPlatform}\ndb.deleteBlob(b) → ${afterDb}\nmissing key no-op: ${missingOk}\nsessions in store: ${sessionsUntouched}</pre>`,
      );
      return { before, afterPlatform, afterDb, missingOk, hasInInterface: typeof platform.storage.deleteBlob === "function" };
    });
    check("storage: platform.storage.deleteBlob exists", r.hasInInterface, r);
    check("storage: deleteBlob(a) removes only a", r.before.join() === "true,true" && r.afterPlatform.join() === "false,true", r);
    check("storage: db.deleteBlob (detached) removes b", r.afterDb.join() === "false,false", r.afterDb);
    check("storage: deleting a missing key resolves", r.missingOk, r.missingOk);
    await shot(page, `${OUT}/storage-deleteBlob.png`);
  } finally {
    writeFileSync(`${OUT}/storage-console.log`, logs.join("\n"));
    await browser.close();
  }
}

if (mode === "fake") {
  // Scripted Gemini Live messages (relative to the setup message). The 3rd sentence starts at +4.0s
  // ("다만" first shown), is carried across the final and flushed by stop(). Before the fix it got
  // the utterance start (VAD) → t smaller than sentences 1–2 (G2 round3: 18.3, 18.6, 18.1).
  const SCRIPT = [
    [1500, { serverContent: { interimInputTranscription: { text: "네." } } }],
    [2500, { serverContent: { interimInputTranscription: { text: "네. 지금 원가가" } } }],
    [4000, { serverContent: { interimInputTranscription: { text: "네. 지금 원가가 스티로폼보다 높은 건 맞습니다. 다만" } } }],
    [4500, { serverContent: { inputTranscription: { text: "네. 지금 원가가 스티로폼보다 높은 건 맞습니다. 다만 저희 원료는" } } }],
    [6000, { serverContent: { interimInputTranscription: { text: "처리비를 받고" } } }],
    [7000, { serverContent: { inputTranscription: { text: "처리비를 받고 수거하는 수산 부산물이라서" } } }],
  ];
  const { browser, page, logs } = await launchCore({ fakeAudioWav: `${AUDIO}/answer-ko-16k.wav` });
  try {
    await page.evaluate((SCRIPT) => {
      window.__mode = "scripted Live socket";
      const Real = window.WebSocket;
      window.__wsLog = [];
      window.WebSocket = class extends EventTarget {
        constructor(url) {
          if (!String(url).includes("generativelanguage")) return new Real(url);
          super();
          this.readyState = 0;
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.({});
          }, 50);
        }
        send(msg) {
          const m = typeof msg === "string" ? JSON.parse(msg) : null;
          if (m?.setup) {
            window.__t0 = performance.now();
            this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) });
            for (const [ms, body] of SCRIPT) setTimeout(() => this.readyState === 1 && (window.__wsLog.push([ms, performance.now() - window.__t0]), this.onmessage?.({ data: JSON.stringify(body) })), ms);
          }
        }
        close() {
          this.readyState = 3;
          setTimeout(() => this.onclose?.({ code: 1000, reason: "" }), 0);
        }
      };
    }, SCRIPT);
    await page.evaluate(MOUNT);
    await page.waitForFunction(() => window.T.start, { timeout: 15000 });
    await page.evaluate(() => {
      window.__startAt = performance.now();
      void window.T.start(0);
    });
    await page.waitForFunction(() => window.T.status === "listening", { timeout: 15000 });
    await sleep(8500);
    const ret = await page.evaluate(() => window.T.stop());
    await sleep(500);
    const got = await page.evaluate(() => window.T.got.map(({ t, text }) => ({ t, text })));
    const wsLog = await page.evaluate(() => window.__wsLog);
    console.log(got);
    const ts = got.map((x) => x.t);
    const setupAt = await page.evaluate(() => (window.__t0 - window.__startAt) / 1000); // socket setup, s after start()
    check("fake: 3 sentences in spoken order (carry merged across the pause)", got.length === 3 && got[0].text === "네." && got[1].text.startsWith("지금") && got[2].text.startsWith("다만") && got[2].text.includes("처리비를"), got);
    check("fake: t strictly ascending (order spoken)", ts.every((t, i) => i === 0 || t > ts[i - 1]), ts);
    // "다만 …" first showed at +4.0s after setup; mark() backs off 1s for recognizer latency → ≈ setup + 3.0s
    const want = Math.round((setupAt + 3.0) * 10) / 10;
    check("fake: carried sentence t = when it started (setup+3.0s), not the utterance start", got[2] && Math.abs(got[2].t - want) <= 0.3, { carried: got[2].t, want, setupAt, first: got[0].t });
    check("fake: stop() returns this run's sentences", ret.length === got.length, ret.length);
    await shot(page, `${OUT}/stt-fake-order.png`);
    writeFileSync(`${OUT}/stt-fake-sentences.json`, JSON.stringify({ script: SCRIPT, delivered: wsLog, sentences: got }, null, 1));
  } finally {
    writeFileSync(`${OUT}/stt-fake-console.log`, logs.join("\n"));
    await browser.close();
  }
}

if (mode === "live") {
  const { browser, page, logs } = await launchCore({ fakeAudioWav: `${AUDIO}/answer-ko-16k.wav` });
  try {
    await page.evaluate(() => (window.__mode = "real Gemini Live"));
    await page.evaluate(MOUNT);
    await page.waitForFunction(() => window.T.start, { timeout: 15000 });
    await page.evaluate(() => void window.T.start(0));
    await page.waitForFunction(() => window.T.status === "listening" || window.T.status === "error", { timeout: 20000 });
    await sleep(40000); // the wav loops: several utterances
    await shot(page, `${OUT}/stt-live-running.png`);
    await page.evaluate(() => window.T.stop());
    await sleep(500);
    const got = await page.evaluate(() => window.T.got.map(({ t, text }) => ({ t, text })));
    const st = await page.evaluate(() => ({ status: window.T.status, error: window.T.error }));
    console.log(got);
    const ts = got.map((x) => x.t);
    check("live: sentences recognized", got.length >= 3, { n: got.length, st });
    check("live: t non-decreasing (order spoken)", ts.every((t, i) => i === 0 || t >= ts[i - 1]), ts);
    await shot(page, `${OUT}/stt-live-order.png`);
    writeFileSync(`${OUT}/stt-live-sentences.json`, JSON.stringify(got, null, 1));
  } finally {
    writeFileSync(`${OUT}/stt-live-console.log`, logs.join("\n"));
    await browser.close();
  }
}

writeFileSync(`${OUT}/results-${mode}.json`, JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
