// CORE verification in a real browser on http://localhost:3000 (see harness.mjs). Writes results.json.
// usage: node run.mjs [--live]   (--live also streams the fixture speech through Gemini Live)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { launchCore } from "./harness.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g2/CORE";
const live = process.argv.includes("--live");
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
};

const { browser, page, logs } = await launchCore({ fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/speech-ko-16k.wav" });
const b64 = (p) => readFileSync(p).toString("base64");
const sha16 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);

try {
  // ── A. PDF: readPdf / validatePdf ──
  const pdf = await page.evaluate(
    async (files) => {
      const m = await import("/__core/features/slide/pdf.ts");
      const toBlob = (b, name) => new File([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], name, { type: "application/pdf" });
      const tryMsg = async (f) => {
        try {
          await m.validatePdf(f);
          return "OK";
        } catch (e) {
          return `${e.name}: ${e.message}`;
        }
      };
      const out = {};
      for (const name of ["presentation", "proposal"]) {
        const blob = await (await fetch(`/samples/${name}.pdf`)).blob();
        const t0 = performance.now();
        const info = await m.readPdf(new File([blob], `${name}.pdf`, { type: "application/pdf" }));
        out[name] = { docId: info.docId, pageCount: info.pageCount, bytes: info.bytes, emptyPages: info.emptyPages, chars: info.pageTexts.join("").length, p1: info.pageTexts[0].slice(0, 80), ms: Math.round(performance.now() - t0) };
      }
      out.mixed = await m.validatePdf(toBlob(files.mixed, "mixed.pdf"));
      out.encrypted = await tryMsg(toBlob(files.encrypted, "encrypted.pdf"));
      out.broken = await tryMsg(toBlob(files.broken, "broken.pdf"));
      out.large = await tryMsg(toBlob(files.large, "large-128p.pdf"));
      out.notPdf = await tryMsg(new File(["hello, this is text"], "notes.pdf", { type: "application/pdf" }));
      out.wrongType = await tryMsg(new File(["%PDF-1.4"], "photo.png", { type: "image/png" }));
      out.empty = await tryMsg(new File([], "empty.pdf", { type: "application/pdf" }));
      out.huge = await tryMsg(new File([new Uint8Array(31 * 1024 * 1024)], "huge.pdf", { type: "application/pdf" }));
      out.limits = m.PDF_LIMITS;
      return out;
    },
    { mixed: b64(`${OUT}/pdfs/mixed.pdf`), encrypted: b64(`${OUT}/pdfs/encrypted.pdf`), broken: b64(`${OUT}/pdfs/broken.pdf`), large: b64(`${OUT}/pdfs/large-128p.pdf`) },
  );
  const samples = "/Users/jyl/work/study/pr-sim/app/public/samples";
  check("pdf: readPdf presentation (pages, text, docId = sha256[:16])", pdf.presentation.pageCount > 0 && pdf.presentation.chars > 200 && pdf.presentation.docId === sha16(`${samples}/presentation.pdf`), pdf.presentation);
  check("pdf: readPdf proposal", pdf.proposal.pageCount > 0 && pdf.proposal.chars > 1000 && pdf.proposal.docId === sha16(`${samples}/proposal.pdf`), pdf.proposal);
  check("pdf: validatePdf mixed sizes = 3 pages", pdf.mixed === 3, pdf.mixed);
  check("pdf: encrypted → Korean PdfError", /PdfError: 암호/.test(pdf.encrypted), pdf.encrypted);
  check("pdf: corrupt → Korean PdfError", /PdfError: .*(읽을 수 없|손상|문제)/.test(pdf.broken), pdf.broken);
  check("pdf: 128 pages > cap 120", /PdfError: 쪽수가 너무 많아요\(128쪽\)/.test(pdf.large), pdf.large);
  check("pdf: magic bytes missing", /PdfError: PDF 파일만/.test(pdf.notPdf), pdf.notPdf);
  check("pdf: wrong MIME type", /PdfError: PDF 파일만/.test(pdf.wrongType), pdf.wrongType);
  check("pdf: empty file", /PdfError: 빈 파일/.test(pdf.empty), pdf.empty);
  check("pdf: > 30MB", /PdfError: 파일이 너무 커요\(31\.0MB\)\. 30\.0MB 이하/.test(pdf.huge), pdf.huge);

  // ── B. IndexedDB sessions + blobs ──
  const db = await page.evaluate(async (judgeB64) => {
    const m = await import("/__core/features/session/db.ts");
    const { platform } = await import("/__core/platform/index.ts");
    const out = {};
    const a = await m.createSession({ situation: "투자 심사", presentationMinutes: 5, qaMinutes: 3 });
    const b = await m.createSession({ situation: "공모전", presentationMinutes: 3, qaMinutes: 2 });
    out.idShape = /^s_[0-9a-z]+$/.test(a.id) && a.id !== b.id;
    out.got = (await m.getSession(a.id))?.setup.situation;
    out.missing = (await m.getSession("s_nope")) === undefined;
    // 20 concurrent appends must all survive (single-transaction read-modify-write)
    await Promise.all(Array.from({ length: 20 }, (_, i) => m.updateSession(a.id, (r) => ({ ...r, transcript: [...r.transcript, { id: `p-${i}`, t: i, text: `문장 ${i}`, phase: "presentation", slide: 1 }] }))));
    out.appended = (await m.getSession(a.id)).transcript.length;
    await new Promise((r) => setTimeout(r, 5));
    const patched = await m.updateSession(b.id, { status: "presentation", resume: { phase: "presentation", remainingSec: 100 } });
    out.patched = patched.status === "presentation" && patched.updatedAt > patched.createdAt;
    out.order = (await m.listSessions()).slice(0, 2).map((s) => s.id).join(",") === `${b.id},${a.id}`;
    try {
      await m.updateSession("s_nope", { status: "done" });
      out.updateMissing = "no error";
    } catch (e) {
      out.updateMissing = e.message;
    }
    // blobs: shared PDF + judge photo with thumbnail
    const pdf = await (await fetch("/samples/presentation.pdf")).blob();
    const pdfKey = await m.storePdf("abcd1234abcd1234", pdf);
    const keys = await m.storeJudgeImage("j_test1", { mime: "image/webp", base64: judgeB64 });
    const thumb = await m.getBlob(keys.thumbKey);
    const bmp = await createImageBitmap(thumb);
    out.thumb = { type: thumb.type, w: bmp.width, h: bmp.height, bytes: thumb.size, fullBytes: (await m.getBlob(keys.imageKey)).size };
    const doc = { role: "presentation", docId: "abcd1234abcd1234", filename: "p.pdf", bytes: pdf.size, pageCount: 9, pdfKey, pageTexts: [], emptyPages: [], wikiState: "pending" };
    const judge = { id: "j_test1", name: "준호", temperament: "strict", gender: "male", age: 45, fullName: "김준호", voiceHint: "", ...keys };
    await m.updateSession(a.id, { docs: { presentation: doc }, judges: [judge] });
    await m.updateSession(b.id, { docs: { presentation: doc } });
    await m.deleteSession(a.id);
    out.afterDeleteA = { session: (await m.getSession(a.id)) === undefined, judge: (await m.getBlob(keys.imageKey)) === undefined, thumb: (await m.getBlob(keys.thumbKey)) === undefined, sharedPdfKept: !!(await m.getBlob(pdfKey)) };
    await m.deleteSession(b.id);
    out.afterDeleteB = { pdfGone: (await m.getBlob(pdfKey)) === undefined };
    out.stores = await new Promise((res) => {
      const r = indexedDB.open("pr-sim");
      r.onsuccess = () => {
        const d = r.result;
        res({ version: d.version, stores: [...d.objectStoreNames], keyPath: d.transaction("sessions").objectStore("sessions").keyPath });
        d.close();
      };
    });
    out.platformKeys = Object.keys(platform).join(",");
    return out;
  }, b64("/Users/jyl/work/study/pr-sim/pocs/.data/judge/j_mwdja1fzc0gw5.webp"));
  check("db: ids, get, missing → undefined", db.idShape && db.got === "투자 심사" && db.missing, db);
  check("db: 20 concurrent updateSession appends kept", db.appended === 20, db.appended);
  check("db: patch + updatedAt + list newest first", db.patched && db.order);
  check("db: update unknown id → Korean error", db.updateMissing === "기록을 찾을 수 없어요.", db.updateMissing);
  check("db: judge image + 256px thumb", db.thumb.w === 256 && db.thumb.h === 256 && db.thumb.bytes < db.thumb.fullBytes, db.thumb);
  check("db: delete removes judge blobs, keeps PDF shared by another session", Object.values(db.afterDeleteA).every(Boolean) && db.afterDeleteB.pdfGone, { ...db.afterDeleteA, ...db.afterDeleteB });
  check("db: IndexedDB pr-sim layout (sessions keyPath id + blobs)", db.stores.stores.join() === "blobs,sessions" && db.stores.keyPath === "id", db.stores);
  check("platform: interface keys", db.platformKeys === "useCamera,startMic,queryPermission,audio,storage", db.platformKeys);

  // ── C. API client: error mapping, NDJSON reader, body cap, real routes ──
  const api = await page.evaluate(async () => {
    const m = await import("/__core/features/session/api.ts");
    const out = {};
    const realFetch = window.fetch;
    const ndjson = (chunks, init = {}) => new Response(new ReadableStream({ start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); } }), { status: 200, headers: { "content-type": "application/x-ndjson" }, ...init });
    const err = async (fn) => {
      try {
        await fn();
        return "no error";
      } catch (e) {
        return { name: e.name, code: e.code, message: e.message, retryable: e.retryable, retryAfterSec: e.retryAfterSec };
      }
    };
    out.wait = [45, 130, 7200].map(m.waitText);
    try {
      const events = [];
      window.fetch = async () => ndjson(['{"type":"judge","slot":0,"judge":{"id":"j1"},"mod', 'el":"x"}\n{"type":"error","slot":1,"code":"upstream","message":"사진 실패"}\n', '{"type":"done","ms":5}']);
      const done = await m.streamJudges({ temperaments: ["friendly", "strict"] }, { onEvent: (e) => events.push(e.type + (e.slot ?? "")) });
      out.stream = { events, done };
      window.fetch = async () => ndjson(['{"type":"progress","phase":"extracting"}\n{"type":"error","code":"rate_limited","message":"요청이 많아요. 7200초 뒤 다시 시도해 주세요.","retryable":true}\n']);
      out.streamError = await err(() => m.streamWiki({ role: "presentation", docId: "x", filename: "x", pageTexts: ["a"] }));
      window.fetch = async () => ndjson(['{"type":"progress"}\n']);
      out.streamCut = await err(() => m.streamWiki({ role: "presentation", docId: "x", filename: "x", pageTexts: ["a"] }));
      window.fetch = async () => Response.json({ error: { code: "rate_limited", message: "", retryAfterSec: 150 } }, { status: 429 });
      out.rate = await err(() => m.fetchTts({ text: "안녕하세요", gender: "male", age: 40, temperament: "strict" }));
      window.fetch = async () => new Response("<html>Gateway Timeout</html>", { status: 504 });
      out.gateway = await err(() => m.postFollowup({}));
      window.fetch = async () => { throw new TypeError("Failed to fetch"); };
      out.network = await err(() => m.getSttToken());
      let called = false;
      window.fetch = async () => { called = true; return new Response("{}"); };
      out.tooLarge = await err(() => m.streamWiki({ role: "proposal", docId: "x", filename: "x", pageTexts: ["가".repeat(1_400_000)] }));
      out.tooLargeNoFetch = !called;
      const ac = new AbortController();
      window.fetch = (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
      setTimeout(() => ac.abort(), 20);
      out.abort = await err(() => m.streamReport({ session: {} }, { signal: ac.signal }));
    } finally {
      window.fetch = realFetch;
    }
    // real routes (same origin)
    out.badJudges = await err(() => m.streamJudges({ temperaments: [] }));
    out.token = await m.getSttToken().then((t) => ({ ok: !!t.token, model: t.model, hasConfig: !!t.config, expiresAt: t.expiresAt }), (e) => ({ error: e.message }));
    return out;
  });
  check("api: waitText human-readable", api.wait.join("|") === "45초|약 2분|약 2시간", api.wait);
  check("api: NDJSON split chunks, per-slot error passes through, resolves done", api.stream.events.join() === "judge0,error1,done" && api.stream.done.ms === 5, api.stream);
  check("api: terminal stream error → ApiError, seconds humanized", api.streamError.code === "rate_limited" && api.streamError.message.includes("약 2시간 뒤"), api.streamError);
  check("api: stream without done → upstream", api.streamCut.code === "upstream", api.streamCut);
  check("api: 429 without message → '약 3분 뒤'", api.rate.code === "rate_limited" && api.rate.message === "요청이 많아요. 약 3분 뒤 다시 시도해 주세요." && api.rate.retryable, api.rate);
  check("api: non-JSON 504 → timeout Korean", api.gateway.code === "timeout" && /초과/.test(api.gateway.message), api.gateway);
  check("api: fetch failure → network Korean", api.network.code === "network" && /인터넷 연결/.test(api.network.message), api.network);
  check("api: body > 4MB rejected before sending", api.tooLarge.code === "too_large" && api.tooLargeNoFetch, api.tooLarge);
  check("api: caller abort rethrown as AbortError", api.abort.name === "AbortError", api.abort);
  check("api: real /api/judges bad body → bad_request Korean", api.badJudges.code === "bad_request" && /[가-힣]/.test(api.badJudges.message), api.badJudges);
  check("api: real /api/stt/token", api.token.ok && !!api.token.model, api.token);

  // ── D. mic worklet (fake audio) + E. playback ──
  const media = await page.evaluate(async () => {
    const { platform, rms } = await import("/__core/platform/index.ts");
    const out = {};
    let frames = 0, len = 0, peak = 0;
    const mic = await platform.startMic((f) => { frames++; len = f.length; peak = Math.max(peak, rms(f)); });
    await new Promise((r) => setTimeout(r, 2000));
    mic.stop();
    out.mic = { frames, len, peak: +peak.toFixed(3), sampleRate: mic.sampleRate };
    out.permission = await platform.queryPermission("mic");
    // 0.4s 440Hz WAV
    const n = 16000 * 0.4, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((i / 16000) * 2 * Math.PI * 440) * 8000, true);
    platform.audio.unlock();
    const t0 = performance.now();
    await platform.audio.play(new Blob([buf], { type: "audio/wav" })).done;
    out.playMs = Math.round(performance.now() - t0);
    const p2 = platform.audio.play(new Blob([buf], { type: "audio/wav" }));
    platform.audio.stopAll();
    out.stopResolves = await Promise.race([p2.done.then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
    const p3 = platform.audio.play(new Blob([new Uint8Array(10)], { type: "audio/wav" }));
    out.badAudio = await p3.done.then(() => "resolved", (e) => e.message);
    return out;
  });
  check("mic: worklet 16kHz 20ms frames from fake audio", media.mic.frames >= 80 && media.mic.len === 320 && media.mic.peak > 0.01, media.mic);
  check("audio: playWav plays to end (~400ms)", media.playMs >= 300 && media.playMs < 3000, media.playMs);
  check("audio: stopAll resolves done", media.stopResolves);
  check("audio: undecodable → Korean error", media.badAudio === "음성을 재생하지 못했어요.", media.badAudio);

  // ── F. Gemini Live round trip (token route + model/config + worklet + SentenceAssembler) ──
  if (live) {
    const stt = await page.evaluate(async () => {
      const { platform } = await import("/__core/platform/index.ts");
      const { getSttToken } = await import("/__core/features/session/api.ts");
      const { SentenceAssembler } = await import("/__core/features/stt/sentences.ts");
      const { GoogleGenAI } = await import("/__nm/@google/genai");
      const tok = await getSttToken();
      const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: "v1alpha" } });
      const asm = new SentenceAssembler();
      const sentences = [];
      let session;
      await new Promise((resolve, reject) => {
        ai.live.connect({ model: tok.model, config: tok.config ?? {}, callbacks: {
          onopen: resolve, onerror: (e) => reject(new Error(e.message)), onclose: () => {},
          onmessage: (m) => { const f = m.serverContent?.inputTranscription?.text; if (f != null) sentences.push(...asm.push(f, true)); },
        } }).then((s) => (session = s), reject);
      });
      const pcm = (f) => { const o = new Uint8Array(f.length * 2), v = new DataView(o.buffer); f.forEach((s, i) => v.setInt16(i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true)); return o; };
      let q = [];
      const mic = await platform.startMic((f) => {
        q.push(pcm(f));
        if (q.length >= 5) { const c = new Uint8Array(q.reduce((a, b) => a + b.length, 0)); let o = 0; for (const b of q) { c.set(b, o); o += b.length; } q = []; let s = ""; for (const x of c) s += String.fromCharCode(x); session.sendRealtimeInput({ audio: { data: btoa(s), mimeType: "audio/pcm;rate=16000" } }); }
      });
      await new Promise((r) => setTimeout(r, 20000));
      mic.stop();
      session.sendRealtimeInput({ audioStreamEnd: true });
      await new Promise((r) => setTimeout(r, 3000));
      session.close();
      sentences.push(...asm.flush());
      return { model: tok.model, sentences };
    });
    check("stt: Gemini Live transcribes fixture speech into sentences", stt.sentences.length >= 2 && stt.sentences.join("").length > 40, stt);
  }
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("afterbegin", `<pre id="core-verify" style="position:fixed;inset:0;z-index:99999;margin:0;padding:12px;background:#fff;color:#111;font:12px/1.4 monospace;white-space:pre-wrap;overflow:auto"></pre>`);
  });
  await page.evaluate((txt) => (document.getElementById("core-verify").textContent = txt), results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}`).join("\n"));
  await shot(page, `${OUT}/core-browser-results.png`);
} catch (e) {
  check("harness", false, String(e?.stack ?? e));
} finally {
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), results, logs: logs.filter((l) => !/Download the React DevTools|HMR/.test(l)) }, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
