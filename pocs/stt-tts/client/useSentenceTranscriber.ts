"use client";
// useSentenceTranscriber — microphone → Korean transcript, one finished sentence at a time.
//
// Modes
//   "live"    (A) Gemini Live (gemini-3.5-transcribe-live) over WebSocket, straight from the browser,
//                 authenticated with a single-use EPHEMERAL token from POST /api/stt-tts/token.
//                 Server-side VAD; interim text while speaking, a final transcript per pause.
//   "chunked" (B) Client energy-VAD cuts utterances on ~600ms silence (cap 15s) → 16kHz WAV →
//                 POST /api/stt-tts/transcribe (gemini-3.5-transcribe) → sentences.
//   "auto"        A, falling back to B when the token/connection fails.
// Both feed a SentenceAssembler, which merges a sentence spoken across a pause into one bubble.
import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptSentence } from "@/lib/types";
import { SentenceAssembler } from "../lib/sentences";
import { floatToPcm16, pcm16ToWav } from "../lib/wav";
import { MicError, rms, startMic, type MicHandle } from "./mic";
import { EnergyVad } from "./vad";

export type TranscriberMode = "auto" | "live" | "chunked";
export type TranscriberStatus = "idle" | "connecting" | "listening" | "stopping" | "error";

export interface LiveSentence extends TranscriptSentence {
  id: string;
  /** ms from the end of speech (local VAD) to the sentence being finalized on screen. */
  latencyMs?: number;
  source: "live" | "chunked";
}

/** A (B-mode) segment whose transcription failed — rendered as its own error bubble. */
export interface SegmentFailure {
  id: string;
  t: number; // seconds from start, like TranscriptSentence.t
  message: string;
  status?: number;
}

export interface TranscriberOptions {
  mode?: TranscriberMode;
  phase?: TranscriptSentence["phase"];
  onSentence?: (s: LiveSentence) => void;
  tokenEndpoint?: string;
  transcribeEndpoint?: string;
  /** Flush an unfinished sentence after this much silence (ms). */
  carryFlushMs?: number;
  /** Client-side timeout for one /transcribe request (ms). */
  transcribeTimeoutMs?: number;
  /** (B) stop with an error after this many segments fail in a row. */
  maxFailStreak?: number;
}

export interface Transcriber {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  status: TranscriberStatus;
  /** Which engine is actually running (auto may resolve to either). */
  activeMode: "live" | "chunked" | null;
  sentences: LiveSentence[];
  /** Unfinished text currently being recognized (carry + interim). */
  partial: string;
  /** `partial` split into sentences — each rendered as an "음성 인식 중" bubble. */
  partialSentences: string[];
  /** True while speech is being captured or an utterance is still being transcribed. */
  inProgress: boolean;
  speaking: boolean;
  level: number; // 0..1 mic level for a meter
  error: string | null;
  notice: string | null;
  /** (B) segments that could not be transcribed (429 / 5xx / timeout) — shown as error bubbles. */
  failures: SegmentFailure[];
  /** Non-fatal but user-visible problem while still listening (e.g. "구간 전사 실패 2건"). */
  warning: string | null;
  startedAt: number | null; // performance.now() at start
}

type LiveSession = { sendRealtimeInput: (p: Record<string, unknown>) => void; close: () => void };

const b64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

export function useSentenceTranscriber(opts: TranscriberOptions = {}): Transcriber {
  const {
    mode = "auto", phase = "presentation", tokenEndpoint = "/api/stt-tts/token", transcribeEndpoint = "/api/stt-tts/transcribe",
    carryFlushMs = 2500, transcribeTimeoutMs = 25_000, maxFailStreak = 3,
  } = opts;
  const [status, setStatus] = useState<TranscriberStatus>("idle");
  const [activeMode, setActiveMode] = useState<"live" | "chunked" | null>(null);
  const [sentences, setSentences] = useState<LiveSentence[]>([]);
  const [partialSentences, setPartialSentences] = useState<string[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [inflight, setInflight] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failures, setFailures] = useState<SegmentFailure[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const onSentenceRef = useRef(opts.onSentence);
  useEffect(() => { onSentenceRef.current = opts.onSentence; });
  // Self-referencing callbacks (reconnect, re-arm timer) go through this ref.
  const selfRefs = useRef({ scheduleCarryFlush: () => {}, connectLive: async () => {}, fail: (msg: string) => { void msg; } });
  const partialSentencesRef = useRef<string[]>([]);
  useEffect(() => { partialSentencesRef.current = partialSentences; }, [partialSentences]);

  // Mutable engine state (not rendered)
  const r = useRef({
    running: false,
    engine: null as "live" | "chunked" | null,
    t0: 0,
    mic: null as MicHandle | null,
    vad: new EnergyVad(),
    asm: new SentenceAssembler(),
    // timing
    utterStartSec: null as number | null, // start of the utterance whose text is being recognized
    sentenceSeenSec: [] as number[], // per-sentence first-seen time within the current utterance (Live)
    lastSpeechEnd: 0, // performance.now() of last local VAD end
    // live
    session: null as LiveSession | null,
    liveOpen: false,
    liveBuf: [] as Uint8Array[], // pcm16 frames waiting to be sent
    pendingSend: [] as Uint8Array[], // buffered while (re)connecting
    reconnects: 0,
    stopRequested: false,
    finalWaiter: null as null | (() => void),
    // chunked
    preRoll: [] as Float32Array[],
    utter: [] as Float32Array[],
    utterStartAt: 0,
    seq: 0,
    nextSeq: 0,
    results: new Map<number, { text: string; startSec: number; endAt: number } | null>(),
    inflight: 0,
    failStreak: 0,
    failCount: 0,
    // misc
    carryTimer: 0 as ReturnType<typeof setTimeout> | 0,
    levelTick: 0,
    idCounter: 0,
  });

  const emit = useCallback(
    (texts: string[], startSec: number, latencyMs: number | undefined, source: "live" | "chunked") => {
      if (!texts.length) return;
      const s = r.current;
      const made = texts.map<LiveSentence>((text) => ({ id: `s${++s.idCounter}`, t: Math.round(startSec * 10) / 10, text, phase, latencyMs, source }));
      setSentences((prev) => [...prev, ...made]);
      made.forEach((m) => onSentenceRef.current?.(m));
    },
    [phase],
  );

  const scheduleCarryFlush = useCallback(() => {
    const s = r.current;
    if (s.carryTimer) clearTimeout(s.carryTimer);
    s.carryTimer = 0;
    if (!s.asm.pending) return;
    s.carryTimer = setTimeout(() => {
      s.carryTimer = 0;
      if (s.vad.speaking) return selfRefs.current.scheduleCarryFlush();
      const out = s.asm.flush();
      emit(out, s.utterStartSec ?? 0, undefined, s.engine ?? "live");
      setPartialSentences([]);
    }, carryFlushMs);
  }, [carryFlushMs, emit]);

  const nowSec = () => (performance.now() - r.current.t0) / 1000;

  // ------------------------------------------------------------------ (A) Live
  const handleLiveMessage = useCallback(
    (m: { serverContent?: { interimInputTranscription?: { text?: string }; inputTranscription?: { text?: string } }; goAway?: unknown }) => {
      const s = r.current;
      const sc = m.serverContent;
      const interim = sc?.interimInputTranscription?.text;
      if (interim) {
        if (s.utterStartSec == null) s.utterStartSec = Math.max(0, nowSec() - 1);
        if (s.carryTimer) { clearTimeout(s.carryTimer); s.carryTimer = 0; }
        const p = s.asm.preview(interim);
        const parts = [...p.complete, p.rest].filter(Boolean);
        // remember when each sentence of this utterance first appeared (≈ when it was spoken)
        for (let i = 0; i < parts.length; i++) s.sentenceSeenSec[i] ??= Math.max(0, nowSec() - 1);
        setPartialSentences(parts);
      }
      const fin = sc?.inputTranscription?.text;
      if (fin != null) {
        const now = performance.now();
        // Speech end for this final: an ongoing pause (VAD not yet closed) or the last closed utterance.
        // (The final often lands after the speaker already started the next sentence.)
        const speechEnd = s.vad.trailingSilenceMs >= 300 ? now - s.vad.trailingSilenceMs : s.lastSpeechEnd;
        const latency = speechEnd ? Math.round(now - speechEnd) : undefined;
        const out = s.asm.push(fin, true);
        const base = s.utterStartSec ?? nowSec();
        out.forEach((txt, i) => emit([txt], s.sentenceSeenSec[i] ?? base, latency != null && latency < 15_000 ? latency : undefined, "live"));
        const pend = s.asm.pending;
        // a carried (unfinished) sentence keeps the time it started being spoken
        s.sentenceSeenSec = pend ? [s.sentenceSeenSec[out.length] ?? base] : [];
        setPartialSentences(pend ? [pend] : []);
        if (!pend) s.utterStartSec = null;
        scheduleCarryFlush();
        s.finalWaiter?.();
      }
    },
    [emit, scheduleCarryFlush],
  );

  const connectLive = useCallback(async (): Promise<void> => {
    const s = r.current;
    const res = await fetch(tokenEndpoint, { method: "POST" });
    const j = (await res.json().catch(() => ({}))) as { token?: string; model?: string; config?: Record<string, unknown>; error?: string };
    if (!res.ok || !j.token || !j.model) throw new Error(j.error ?? `토큰 발급 실패 (${res.status})`);
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: j.token, httpOptions: { apiVersion: "v1alpha" } });
    await new Promise<void>((resolve, reject) => {
      let opened = false;
      ai.live
        .connect({
          model: j.model!,
          config: j.config ?? {},
          callbacks: {
            onopen: () => { opened = true; s.liveOpen = true; resolve(); },
            onmessage: (msg) => {
              handleLiveMessage(msg as Parameters<typeof handleLiveMessage>[0]);
              if ((msg as { goAway?: unknown }).goAway && s.running) {
                // server will close soon: reconnect proactively
                s.session?.close();
              }
            },
            onerror: (e) => { if (!opened) reject(new Error((e as ErrorEvent).message || "Live 연결 오류")); },
            onclose: (e) => {
              s.liveOpen = false;
              s.session = null;
              s.finalWaiter?.();
              if (!opened) return reject(new Error(`Live 연결이 닫혔습니다 (${e.code} ${e.reason})`));
              if (s.running && !s.stopRequested && s.engine === "live") {
                if (s.reconnects++ < 5) {
                  setNotice("Live 세션 재연결 중…");
                  selfRefs.current.connectLive().then(() => setNotice(null)).catch((err) => {
                    setError(`Live 재연결 실패: ${(err as Error).message}`);
                    setStatus("error");
                  });
                } else {
                  setError("Live 연결이 반복해서 끊겼습니다. 'VAD+전사' 모드로 다시 시도해 주세요.");
                  setStatus("error");
                }
              }
            },
          },
        })
        .then((sess) => {
          s.session = sess as unknown as LiveSession;
          // flush audio captured while connecting (max ~10s)
          const q = s.pendingSend.splice(0);
          for (const chunk of q.slice(-100)) s.session.sendRealtimeInput({ audio: { data: b64(chunk), mimeType: "audio/pcm;rate=16000" } });
        })
        .catch(reject);
    });
  }, [handleLiveMessage, tokenEndpoint]);

  useEffect(() => { Object.assign(selfRefs.current, { scheduleCarryFlush, connectLive }); }, [scheduleCarryFlush, connectLive]);

  // ------------------------------------------------------------------ (B) chunked
  const deliverChunked = useCallback(() => {
    const s = r.current;
    while (s.results.has(s.nextSeq)) {
      const res = s.results.get(s.nextSeq);
      s.results.delete(s.nextSeq);
      s.nextSeq++;
      if (!res) continue;
      const out = s.asm.push(res.text, true);
      emit(out, res.startSec, Math.round(performance.now() - res.endAt), "chunked");
      const pend = s.asm.pending;
      setPartialSentences(pend ? [pend] : []);
      scheduleCarryFlush();
    }
  }, [emit, scheduleCarryFlush]);

  const sendUtterance = useCallback(
    (frames: Float32Array[], startSec: number, endAt = performance.now()) => {
      const s = r.current;
      const total = frames.reduce((n, f) => n + f.length, 0);
      if (total < 16000 * 0.35) return; // < 350ms: noise blip
      const pcm = new Float32Array(total);
      let o = 0;
      for (const f of frames) { pcm.set(f, o); o += f.length; }
      const wav = pcm16ToWav(floatToPcm16(pcm), 16000);
      const seq = s.seq++;
      s.inflight++;
      setInflight(s.inflight);
      const runId = s.t0;
      fetch(transcribeEndpoint, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav as BlobPart, signal: AbortSignal.timeout(transcribeTimeoutMs) })
        .then(async (res) => {
          const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string; retryAfterSec?: number; local?: boolean };
          if (!res.ok) throw Object.assign(new Error(j.error ?? `전사 실패 (${res.status})`), { status: res.status, retryAfterSec: j.retryAfterSec, local: j.local });
          s.results.set(seq, { text: j.text ?? "", startSec, endAt });
          if (runId === s.t0) { s.failStreak = 0; setWarning(null); }
        })
        .catch((e: Error & { status?: number; retryAfterSec?: number; local?: boolean }) => {
          s.results.set(seq, null);
          if (runId !== s.t0) return; // a previous run
          const timeout = e.name === "TimeoutError" || e.name === "AbortError";
          const message = timeout ? `전사 응답 시간 초과 (${Math.round(transcribeTimeoutMs / 1000)}초)` : e.message;
          s.failStreak++;
          s.failCount++;
          setFailures((prev) => [...prev, { id: `f${++s.idCounter}`, t: Math.round(startSec * 10) / 10, message, status: e.status }]);
          // Daily provider quota gone → every further segment fails too: stop instead of "듣는 중" forever.
          const quotaGone = e.status === 429 && !e.local && (e.retryAfterSec ?? 0) > 3600;
          if (s.running && !s.stopRequested && (quotaGone || s.failStreak >= maxFailStreak)) {
            selfRefs.current.fail(
              quotaGone
                ? `전사를 중단했습니다: ${message}`
                : `구간 전사가 ${s.failStreak}번 연속 실패해 전사를 중단했습니다. (${message})`,
            );
          } else {
            setWarning(`구간 전사 실패 ${s.failCount}건 — 해당 구간은 말풍선이 생기지 않습니다. (${message})`);
          }
        })
        .finally(() => {
          s.inflight--;
          setInflight(s.inflight);
          deliverChunked();
        });
    },
    [deliverChunked, transcribeEndpoint, transcribeTimeoutMs, maxFailStreak],
  );

  // ------------------------------------------------------------------ audio frames
  const onFrame = useCallback(
    (frame: Float32Array) => {
      const s = r.current;
      if (!s.running) return;
      const lv = rms(frame);
      const ev = s.vad.feed(lv);
      if (ev?.type === "start") {
        setSpeaking(true);
        if (s.engine === "chunked") {
          s.utter = [...s.preRoll, frame];
          s.utterStartAt = Math.max(0, nowSec() - s.preRoll.length * 0.02);
        }
        if (s.utterStartSec == null) s.utterStartSec = Math.max(0, nowSec() - 0.06);
      } else if (ev?.type === "end") {
        // the VAD closes `silenceMs` after the last voiced frame — latency is measured from that frame
        s.lastSpeechEnd = performance.now() - (ev.reason === "silence" ? s.vad.silenceMs : 0);
        if (ev.reason === "silence") setSpeaking(false);
        if (s.engine === "chunked") {
          s.utter.push(frame);
          sendUtterance(s.utter, s.utterStartAt, s.lastSpeechEnd);
          s.utter = [];
          s.utterStartAt = nowSec();
          if (ev.reason === "silence") s.utterStartSec = null;
        }
      } else if (s.engine === "chunked" && s.vad.speaking) {
        s.utter.push(frame);
      }
      if (s.engine === "chunked") {
        s.preRoll.push(frame);
        if (s.preRoll.length > 10) s.preRoll.shift();
      }
      // Live: send 100ms chunks
      if (s.engine === "live") {
        s.liveBuf.push(floatToPcm16(frame));
        if (s.liveBuf.length >= 5) {
          const n = s.liveBuf.reduce((a, b) => a + b.length, 0);
          const chunk = new Uint8Array(n);
          let o = 0;
          for (const b of s.liveBuf) { chunk.set(b, o); o += b.length; }
          s.liveBuf = [];
          if (s.session && s.liveOpen) s.session.sendRealtimeInput({ audio: { data: b64(chunk), mimeType: "audio/pcm;rate=16000" } });
          else s.pendingSend.push(chunk);
        }
      }
      // throttle meter updates to ~12fps
      if (++s.levelTick % 4 === 0) setLevel(Math.min(1, lv * 8));
    },
    [sendUtterance],
  );

  // ------------------------------------------------------------------ public API
  const teardown = useCallback(() => {
    const s = r.current;
    s.running = false;
    s.mic?.stop();
    s.mic = null;
    try { s.session?.close(); } catch { /* ignore */ }
    s.session = null;
    s.liveOpen = false;
    if (s.carryTimer) clearTimeout(s.carryTimer);
    s.carryTimer = 0;
    setLevel(0);
    setSpeaking(false);
  }, []);

  const start = useCallback(async () => {
    const s = r.current;
    if (s.running) return;
    setError(null);
    setNotice(null);
    setWarning(null);
    setStatus("connecting");
    Object.assign(s, {
      running: true, stopRequested: false, t0: performance.now(), engine: null, utterStartSec: null, sentenceSeenSec: [], lastSpeechEnd: 0,
      liveBuf: [], pendingSend: [], reconnects: 0, preRoll: [], utter: [], seq: 0, nextSeq: 0, inflight: 0, failStreak: 0, failCount: 0,
    });
    s.results.clear();
    s.vad = new EnergyVad();
    s.asm.reset();
    setStartedAt(s.t0);
    setPartialSentences([]);
    try {
      s.engine = mode === "chunked" ? "chunked" : "live"; // decide before audio starts so frames are buffered
      s.mic = await startMic(onFrame);
    } catch (e) {
      teardown();
      setStatus("error");
      setError(e instanceof MicError ? e.message : `마이크 오류: ${(e as Error).message}`);
      return;
    }
    if (s.engine === "live") {
      try {
        await connectLive();
      } catch (e) {
        if (mode === "auto" && s.running) {
          s.engine = "chunked";
          s.pendingSend = [];
          setNotice(`Live 연결 실패 → VAD+전사 모드로 전환했습니다. (${(e as Error).message})`);
        } else {
          teardown();
          setStatus("error");
          setError(`Live 연결 실패: ${(e as Error).message}`);
          return;
        }
      }
    }
    if (!s.running) return;
    setActiveMode(s.engine);
    setStatus("listening");
  }, [connectLive, mode, onFrame, teardown]);

  const stop = useCallback(async () => {
    const s = r.current;
    if (!s.running) return;
    s.stopRequested = true;
    setStatus("stopping");
    s.mic?.stop();
    s.mic = null;
    if (s.engine === "live" && s.session) {
      // ask the server to finalize what it heard, wait briefly for the last transcript
      try { s.session.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* ignore */ }
      if (s.vad.speaking || partialSentencesRef.current.length) {
        await new Promise<void>((res) => { s.finalWaiter = res; setTimeout(res, 3000); });
        s.finalWaiter = null;
      }
    }
    if (s.engine === "chunked") {
      if (s.vad.speaking && s.utter.length) sendUtterance(s.utter, s.utterStartAt);
      s.utter = [];
      const deadline = performance.now() + 15_000;
      while (s.inflight > 0 && performance.now() < deadline) await new Promise((res) => setTimeout(res, 100));
    }
    emit(s.asm.flush(), s.utterStartSec ?? nowSec(), undefined, s.engine ?? "live");
    setPartialSentences([]);
    teardown();
    setStatus("idle");
  }, [emit, sendUtterance, teardown]);

  /** Fatal error while running: release the mic, keep what was transcribed, show the error. */
  const fail = useCallback(
    (msg: string) => {
      const s = r.current;
      emit(s.asm.flush(), s.utterStartSec ?? nowSec(), undefined, s.engine ?? "chunked");
      setPartialSentences([]);
      teardown();
      setWarning(null);
      setError(msg);
      setStatus("error");
    },
    [emit, teardown],
  );
  useEffect(() => { selfRefs.current.fail = fail; }, [fail]);

  const reset = useCallback(() => {
    setSentences([]);
    setPartialSentences([]);
    setFailures([]);
    setWarning(null);
    setError(null);
    setNotice(null);
    r.current.asm.reset();
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const partial = partialSentences.join(" ");
  return {
    start, stop, reset, status, activeMode, sentences, partial, partialSentences,
    inProgress: speaking || inflight > 0 || partialSentences.length > 0,
    speaking, level, error, notice, failures, warning, startedAt,
  };
}
