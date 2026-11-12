"use client";
// useSentenceTranscriber — microphone → Korean transcript, one finished sentence at a time.
// Gemini Live (transcription model) over WebSocket straight from the browser, authenticated with a
// single-use ephemeral token from POST /api/stt/token (the API key never leaves the server).
// Server-side VAD: interim text while speaking, a final transcript per pause. A SentenceAssembler
// merges a sentence spoken across a pause into one sentence.
import { useCallback, useEffect, useRef, useState } from "react";
import { MediaAccessError, platform, rms, type MicHandle } from "@/platform";
import { getSttToken } from "@/features/session/api";
import type { TranscriptSentence } from "@/features/session/types";
import { SentenceAssembler } from "./sentences";
import { EnergyVad } from "./vad";

export type TranscriberStatus = "idle" | "connecting" | "listening" | "stopping" | "error";

export interface TranscriberOptions {
  phase: TranscriptSentence["phase"];
  /** Slide shown right now (1-based); read when a sentence starts. Omit in the Q&A phase. */
  getSlide?: () => number | undefined;
  /** Called for every finished sentence (persist it here). */
  onSentence?: (s: TranscriptSentence) => void;
  /** Flush an unfinished sentence after this much silence (ms). */
  carryFlushMs?: number;
}

export interface Transcriber {
  /** Start listening. `offsetSec` = seconds already elapsed in this phase (resumed session), added to `t`. */
  start: (offsetSec?: number) => Promise<void>;
  /** Stop, wait briefly for the last words, and return the sentences finished during this run. */
  stop: () => Promise<TranscriptSentence[]>;
  status: TranscriberStatus;
  /** Sentences finished since the hook mounted (all runs). */
  sentences: TranscriptSentence[];
  /** Unfinished text currently being recognized, split into sentences ("음성 인식 중" bubbles). */
  partialSentences: string[];
  speaking: boolean;
  level: number; // 0..1 mic level for a meter
  error: string | null;
  /** Non-fatal state, e.g. reconnecting. */
  notice: string | null;
}

type LiveSession = { sendRealtimeInput: (p: Record<string, unknown>) => void; close: () => void };
type Mark = { t: number; slide?: number };

const b64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Float32 [-1,1] mono samples -> 16-bit PCM bytes (little endian). */
function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

const LIVE_FAILED = "음성 인식 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.";

export function useSentenceTranscriber(opts: TranscriberOptions): Transcriber {
  const { phase, carryFlushMs = 2500 } = opts;
  const [status, setStatus] = useState<TranscriberStatus>("idle");
  const [sentences, setSentences] = useState<TranscriptSentence[]>([]);
  const [partialSentences, setPartialSentences] = useState<string[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cb = useRef({ onSentence: opts.onSentence, getSlide: opts.getSlide });
  useEffect(() => {
    cb.current = { onSentence: opts.onSentence, getSlide: opts.getSlide };
  });
  // Self-referencing callbacks (reconnect, re-arm timer) go through this ref.
  const selfRefs = useRef({ scheduleCarryFlush: () => {}, connectLive: async () => {} });
  const partialRef = useRef<string[]>([]);
  useEffect(() => {
    partialRef.current = partialSentences;
  }, [partialSentences]);

  // Mutable engine state (not rendered)
  const r = useRef({
    running: false,
    gen: 0, // bumped by start() and teardown(); async work from an older run sees a stale value and backs out
    t0: 0,
    offset: 0,
    runId: "",
    seq: 0,
    run: [] as TranscriptSentence[], // sentences of the current run (returned by stop)
    mic: null as MicHandle | null,
    vad: new EnergyVad(),
    asm: new SentenceAssembler(),
    utterStart: null as Mark | null, // start of the utterance whose text is being recognized
    seen: [] as Mark[], // per-sentence first-seen mark within the current utterance
    session: null as LiveSession | null,
    liveOpen: false,
    liveBuf: [] as Uint8Array[], // pcm16 frames waiting to be sent
    pendingSend: [] as Uint8Array[], // buffered while (re)connecting
    reconnects: 0,
    stopRequested: false,
    finalWaiter: null as null | (() => void),
    carryTimer: 0 as ReturnType<typeof setTimeout> | 0,
    levelTick: 0,
  });

  const mark = useCallback((backSec: number): Mark => {
    const s = r.current;
    const t = Math.max(0, s.offset + (performance.now() - s.t0) / 1000 - backSec);
    const slide = phase === "presentation" ? cb.current.getSlide?.() : undefined;
    return slide != null ? { t, slide } : { t };
  }, [phase]);

  const emit = useCallback(
    (texts: string[], m: Mark) => {
      if (!texts.length) return;
      const s = r.current;
      const made = texts.map<TranscriptSentence>((text) => ({ id: `${s.runId}-${++s.seq}`, t: Math.round(m.t * 10) / 10, text, phase, ...(m.slide != null ? { slide: m.slide } : {}) }));
      s.run.push(...made);
      setSentences((prev) => [...prev, ...made]);
      made.forEach((x) => cb.current.onSentence?.(x));
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
      emit(s.asm.flush(), s.utterStart ?? mark(0));
      s.utterStart = null;
      s.seen = [];
      setPartialSentences([]);
    }, carryFlushMs);
  }, [carryFlushMs, emit, mark]);

  const handleLiveMessage = useCallback(
    (m: { serverContent?: { interimInputTranscription?: { text?: string }; inputTranscription?: { text?: string } } }) => {
      const s = r.current;
      const sc = m.serverContent;
      const interim = sc?.interimInputTranscription?.text;
      if (interim) {
        s.utterStart ??= mark(1);
        if (s.carryTimer) {
          clearTimeout(s.carryTimer);
          s.carryTimer = 0;
        }
        const p = s.asm.preview(interim);
        const parts = [...p.complete, p.rest].filter(Boolean);
        // remember when (and on which slide) each sentence of this utterance first appeared
        for (let i = 0; i < parts.length; i++) s.seen[i] ??= mark(1);
        setPartialSentences(parts);
      }
      const fin = sc?.inputTranscription?.text;
      if (fin != null) {
        const out = s.asm.push(fin, true);
        const base = s.utterStart ?? mark(0);
        out.forEach((txt, i) => emit([txt], s.seen[i] ?? base));
        const pend = s.asm.pending;
        // a carried (unfinished) sentence keeps the time it started being spoken
        s.seen = pend ? [s.seen[out.length] ?? base] : [];
        setPartialSentences(pend ? [pend] : []);
        if (!pend) s.utterStart = null;
        scheduleCarryFlush();
        s.finalWaiter?.();
      }
    },
    [emit, mark, scheduleCarryFlush],
  );

  const teardown = useCallback(() => {
    const s = r.current;
    s.running = false;
    s.gen++;
    s.mic?.stop();
    s.mic = null;
    try {
      s.session?.close();
    } catch {
      /* ignore */
    }
    s.session = null;
    s.liveOpen = false;
    if (s.carryTimer) clearTimeout(s.carryTimer);
    s.carryTimer = 0;
    setLevel(0);
    setSpeaking(false);
  }, []);

  /** Fatal error while running: keep what was transcribed, release the mic, show the error. */
  const fail = useCallback(
    (msg: string) => {
      const s = r.current;
      emit(s.asm.flush(), s.utterStart ?? mark(0));
      setPartialSentences([]);
      teardown();
      setNotice(null);
      setError(msg);
      setStatus("error");
    },
    [emit, mark, teardown],
  );

  const connectLive = useCallback(async (): Promise<void> => {
    const s = r.current;
    const gen = s.gen;
    const stale = () => s.gen !== gen;
    const tok = await getSttToken();
    const { GoogleGenAI } = await import("@google/genai");
    if (stale()) return; // stopped while fetching the token: don't open a socket
    const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: "v1alpha" } });
    await new Promise<void>((resolve, reject) => {
      let opened = false;
      let sess: LiveSession | null = null;
      // a socket from an older run, or one already replaced, must not touch the shared state
      const foreign = () => stale() || (sess !== null && sess !== s.session);
      ai.live
        .connect({
          model: tok.model,
          config: tok.config ?? {},
          callbacks: {
            onopen: () => {
              opened = true;
              if (!stale()) s.liveOpen = true;
              resolve();
            },
            onmessage: (msg) => {
              if (foreign()) return;
              handleLiveMessage(msg as Parameters<typeof handleLiveMessage>[0]);
              // server will close soon: reconnect proactively
              if ((msg as { goAway?: unknown }).goAway && s.running) s.session?.close();
            },
            onerror: (e) => {
              console.warn("[stt] live error", (e as ErrorEvent).message);
              if (!opened) reject(new Error(LIVE_FAILED));
            },
            onclose: (e) => {
              if (!opened) {
                console.warn("[stt] live closed before open", e.code, e.reason);
                return reject(new Error(LIVE_FAILED));
              }
              if (foreign()) return;
              s.liveOpen = false;
              s.session = null;
              s.finalWaiter?.();
              if (s.running && !s.stopRequested) {
                if (s.reconnects++ < 5) {
                  setNotice("음성 인식 연결이 끊겨 다시 연결하고 있어요.");
                  selfRefs.current
                    .connectLive()
                    .then(() => !stale() && setNotice(null))
                    .catch((err: Error) => !stale() && fail(err.message || LIVE_FAILED));
                } else {
                  fail("음성 인식 연결이 계속 끊겨요. 잠시 뒤 다시 시작해 주세요.");
                }
              }
            },
          },
        })
        .then((x) => {
          sess = x as unknown as LiveSession;
          if (stale()) {
            // stop()/unmount ran while connecting: close this socket instead of keeping it
            try {
              sess.close();
            } catch {
              /* ignore */
            }
            return;
          }
          s.session = sess;
          // flush audio captured while connecting (max ~10s)
          const q = s.pendingSend.splice(0);
          for (const chunk of q.slice(-100)) sess.sendRealtimeInput({ audio: { data: b64(chunk), mimeType: "audio/pcm;rate=16000" } });
        })
        .catch(() => reject(new Error(LIVE_FAILED)));
    });
  }, [fail, handleLiveMessage]);

  useEffect(() => {
    Object.assign(selfRefs.current, { scheduleCarryFlush, connectLive });
  }, [scheduleCarryFlush, connectLive]);

  const onFrame = useCallback(
    (frame: Float32Array) => {
      const s = r.current;
      if (!s.running) return;
      const lv = rms(frame);
      const ev = s.vad.feed(lv);
      if (ev?.type === "start") {
        setSpeaking(true);
        s.utterStart ??= mark(0.06);
      } else if (ev?.type === "end" && ev.reason === "silence") {
        setSpeaking(false);
      }
      // send 100ms chunks
      s.liveBuf.push(floatToPcm16(frame));
      if (s.liveBuf.length >= 5) {
        const n = s.liveBuf.reduce((a, b) => a + b.length, 0);
        const chunk = new Uint8Array(n);
        let o = 0;
        for (const b of s.liveBuf) {
          chunk.set(b, o);
          o += b.length;
        }
        s.liveBuf = [];
        if (s.session && s.liveOpen) s.session.sendRealtimeInput({ audio: { data: b64(chunk), mimeType: "audio/pcm;rate=16000" } });
        else s.pendingSend.push(chunk);
      }
      // throttle meter updates to ~12fps
      if (++s.levelTick % 4 === 0) setLevel(Math.min(1, lv * 8));
    },
    [mark],
  );


  const start = useCallback(
    async (offsetSec = 0) => {
      const s = r.current;
      if (s.running) return;
      const gen = ++s.gen;
      const stale = () => s.gen !== gen;
      setError(null);
      setNotice(null);
      setStatus("connecting");
      Object.assign(s, {
        running: true,
        stopRequested: false,
        t0: performance.now(),
        offset: Math.max(0, offsetSec),
        runId: `${phase === "presentation" ? "p" : "q"}${Date.now().toString(36)}`,
        seq: 0,
        run: [],
        utterStart: null,
        seen: [],
        liveBuf: [],
        pendingSend: [],
        reconnects: 0,
      });
      s.vad = new EnergyVad();
      s.asm.reset();
      setPartialSentences([]);
      try {
        // mic first, so audio spoken while the Live socket connects is buffered and sent on open
        const mic = await platform.startMic(onFrame);
        if (stale()) {
          mic.stop(); // stop()/unmount ran while waiting for mic permission
          return;
        }
        s.mic = mic;
      } catch (e) {
        if (stale()) return;
        teardown();
        setStatus("error");
        setError(e instanceof MediaAccessError ? e.message : "마이크를 시작하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      try {
        await connectLive();
      } catch (e) {
        if (stale()) return;
        teardown();
        setStatus("error");
        setError((e as Error).message || LIVE_FAILED);
        return;
      }
      if (!stale()) setStatus("listening");
    },
    [connectLive, onFrame, phase, teardown],
  );

  const stop = useCallback(async (): Promise<TranscriptSentence[]> => {
    const s = r.current;
    if (!s.running) return s.run.splice(0);
    s.stopRequested = true;
    setStatus("stopping");
    s.mic?.stop();
    s.mic = null;
    if (s.session) {
      // ask the server to finalize what it heard, wait briefly for the last transcript
      try {
        s.session.sendRealtimeInput({ audioStreamEnd: true });
      } catch {
        /* ignore */
      }
      if (s.vad.speaking || partialRef.current.length) {
        await new Promise<void>((res) => {
          s.finalWaiter = res;
          setTimeout(res, 3000);
        });
        s.finalWaiter = null;
      }
    }
    emit(s.asm.flush(), s.utterStart ?? mark(0));
    setPartialSentences([]);
    teardown();
    setStatus("idle");
    return s.run.splice(0);
  }, [emit, mark, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return { start, stop, status, sentences, partialSentences, speaking, level, error, notice };
}
