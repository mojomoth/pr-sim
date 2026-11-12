"use client";
// Microphone capture -> 16kHz mono Float32 frames (20ms) via an AudioWorklet in /public/stt-tts.

export type MicErrorKind = "denied" | "notfound" | "insecure" | "busy" | "unknown";
export class MicError extends Error {
  constructor(public kind: MicErrorKind, message: string) {
    super(message);
  }
}

export const MIC_ERROR_TEXT: Record<MicErrorKind, string> = {
  denied: "마이크 권한이 거부되었습니다. 브라우저 주소창의 권한 설정에서 마이크를 허용한 뒤 다시 시도해 주세요.",
  notfound: "사용할 수 있는 마이크를 찾지 못했습니다. 마이크 연결을 확인해 주세요.",
  insecure: "마이크는 HTTPS 또는 localhost에서만 사용할 수 있습니다.",
  busy: "다른 앱이 마이크를 사용 중입니다. 다른 앱을 종료한 뒤 다시 시도해 주세요.",
  unknown: "마이크를 시작하지 못했습니다.",
};

export interface MicHandle {
  stop: () => void;
  sampleRate: number;
}

export async function startMic(onFrame: (frame: Float32Array) => void): Promise<MicHandle> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicError(window.isSecureContext ? "notfound" : "insecure", window.isSecureContext ? MIC_ERROR_TEXT.notfound : MIC_ERROR_TEXT.insecure);
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    const kind: MicErrorKind =
      name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "notfound" : name === "NotReadableError" ? "busy" : "unknown";
    throw new MicError(kind, MIC_ERROR_TEXT[kind]);
  }
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/stt-tts/pcm16k-worklet.js");
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm16k");
  node.port.onmessage = (ev: MessageEvent<Float32Array>) => onFrame(ev.data);
  src.connect(node);
  // Worklet must be pulled by the graph; route through a muted gain so nothing is audible.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  return {
    sampleRate: ctx.sampleRate,
    stop: () => {
      node.port.onmessage = null;
      try { src.disconnect(); node.disconnect(); } catch { /* already disconnected */ }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    },
  };
}

export function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}
