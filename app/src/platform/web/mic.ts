"use client";
// Microphone capture -> 16kHz mono Float32 frames (20ms) via an AudioWorklet in /public/worklets.
import { classifyMediaError, MediaAccessError, mediaUnavailable } from "./media";

const WORKLET_URL = "/worklets/pcm16k-worklet.js";

export interface MicHandle {
  stop: () => void;
  sampleRate: number;
}

/** Start the microphone. Throws MediaAccessError (denied / nodevice / busy / insecure / unsupported). */
export async function startMic(onFrame: (frame: Float32Array) => void): Promise<MicHandle> {
  const why = mediaUnavailable();
  if (why) throw new MediaAccessError(why, "mic");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    throw new MediaAccessError(classifyMediaError(e), "mic");
  }
  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule(WORKLET_URL);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    throw e;
  }
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
      try {
        src.disconnect();
        node.disconnect();
      } catch {
        /* already disconnected */
      }
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
