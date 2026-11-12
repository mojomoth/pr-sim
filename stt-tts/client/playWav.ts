"use client";
// Minimal audio playback for TTS results (Blob / ArrayBuffer / URL). One clip at a time.

export interface Playback {
  done: Promise<void>;
  stop: () => void;
  audio: HTMLAudioElement;
}

let current: Playback | null = null;

export function stopAll() {
  current?.stop();
  current = null;
}

export function playWav(src: Blob | ArrayBuffer | Uint8Array | string, opts: { exclusive?: boolean; onEnd?: () => void } = {}): Playback {
  if (opts.exclusive !== false) stopAll();
  const url = typeof src === "string" ? src : URL.createObjectURL(src instanceof Blob ? src : new Blob([src as BlobPart], { type: "audio/wav" }));
  const audio = new Audio(url);
  let finish!: () => void;
  let fail!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => { finish = res; fail = rej; });
  const cleanup = () => { if (typeof src !== "string") URL.revokeObjectURL(url); if (current?.audio === audio) current = null; };
  audio.onended = () => { cleanup(); opts.onEnd?.(); finish(); };
  audio.onerror = () => { cleanup(); fail(new Error("오디오 재생 실패")); };
  const pb: Playback = {
    audio,
    done,
    stop: () => { audio.pause(); cleanup(); opts.onEnd?.(); finish(); },
  };
  current = pb;
  audio.play().catch((e) => { cleanup(); fail(e); });
  return pb;
}

/** POST /api/stt-tts/tts and return the WAV + resolved persona metadata (from response headers). */
export async function fetchTts(body: { text: string; gender: "male" | "female"; age: number; temperament: "friendly" | "strict" | "aggressive" }, endpoint = "/api/stt-tts/tts") {
  const t0 = performance.now();
  const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; retryAfterSec?: number };
    const err = new Error(j.error ?? `TTS 실패 (${res.status})`) as Error & { retryAfterSec?: number; status?: number };
    err.retryAfterSec = j.retryAfterSec;
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  return {
    blob,
    voice: res.headers.get("x-voice") ?? "",
    style: decodeURIComponent(res.headers.get("x-style") ?? ""),
    model: res.headers.get("x-model") ?? "",
    cached: res.headers.get("x-cache") === "HIT",
    durationSec: Number(res.headers.get("x-duration") || 0),
    serverMs: Number(res.headers.get("x-ms") || 0),
    totalMs: Math.round(performance.now() - t0),
  };
}
