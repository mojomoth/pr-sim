"use client";
// Audio playback for TTS results. One clip at a time, through ONE reused <audio> element so that a
// single unlockAudio() inside a tap lets later clips play without a gesture (iOS Safari / WebView).

export interface Playback {
  /** Resolves when the clip ends or is stopped; rejects if it cannot play. */
  done: Promise<void>;
  stop: () => void;
}

const SILENT_WAV =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

let el: HTMLAudioElement | null = null;
let unlocked = false;
let current: Playback | null = null;

function audioEl(): HTMLAudioElement {
  el ??= new Audio();
  return el;
}

/** Call from a click/tap handler (e.g. "발표 시작") so judge voices can autoplay later. */
export function unlockAudio() {
  if (unlocked || typeof window === "undefined") return;
  const a = audioEl();
  a.src = SILENT_WAV;
  a.play()
    .then(() => {
      unlocked = true;
      a.pause();
    })
    .catch(() => {});
}

export function stopAll() {
  current?.stop();
  current = null;
}

/** Play a WAV (Blob / bytes / URL). Stops whatever was playing. */
export function playWav(src: Blob | ArrayBuffer | Uint8Array | string, opts: { onEnd?: () => void } = {}): Playback {
  stopAll();
  const a = audioEl();
  const url = typeof src === "string" ? src : URL.createObjectURL(src instanceof Blob ? src : new Blob([src as BlobPart], { type: "audio/wav" }));
  let settled = false;
  let finish!: () => void;
  let fail!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    finish = res;
    fail = rej;
  });
  const settle = (err?: unknown) => {
    if (settled) return;
    settled = true;
    a.onended = a.onerror = null;
    if (typeof src !== "string") URL.revokeObjectURL(url);
    if (current === pb) current = null;
    if (err) fail(err);
    else {
      opts.onEnd?.();
      finish();
    }
  };
  const pb: Playback = {
    done,
    stop: () => {
      if (settled) return;
      a.pause();
      settle();
    },
  };
  current = pb;
  a.onended = () => settle();
  a.onerror = () => settle(new Error("음성을 재생하지 못했어요."));
  a.src = url;
  a.play().catch((e: unknown) => {
    const blocked = (e as { name?: string })?.name === "NotAllowedError";
    settle(new Error(blocked ? "소리를 들으려면 화면을 한 번 눌러 주세요." : "음성을 재생하지 못했어요."));
  });
  return pb;
}
