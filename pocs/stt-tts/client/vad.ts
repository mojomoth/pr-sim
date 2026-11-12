// Energy-based voice activity detector on 20ms frames with an adaptive noise floor.
// Used for (B) utterance segmentation and, in (A), only to timestamp speech end for latency metrics.

export interface VadOptions {
  frameMs?: number; // 20
  startFrames?: number; // consecutive voiced frames to open an utterance (3 = 60ms)
  silenceMs?: number; // trailing silence that closes an utterance (600)
  maxUtteranceMs?: number; // hard cap (15000) — forces a cut while still talking
  minThreshold?: number; // absolute RMS floor
}

export type VadEvent = { type: "start" } | { type: "end"; reason: "silence" | "cap" } | null;

export class EnergyVad {
  private o: Required<VadOptions>;
  private noise = 0.004;
  private voicedRun = 0;
  private silentRun = 0;
  private speakingFrames = 0;
  speaking = false;
  constructor(opts: VadOptions = {}) {
    this.o = { frameMs: 20, startFrames: 3, silenceMs: 600, maxUtteranceMs: 15_000, minThreshold: 0.01, ...opts };
  }
  /** ms of silence since the last voiced frame while still in the speaking state. */
  get trailingSilenceMs() {
    return this.speaking ? this.silentRun * this.o.frameMs : 0;
  }
  get silenceMs() {
    return this.o.silenceMs;
  }
  get threshold() {
    return Math.max(this.o.minThreshold, this.noise * 3.5);
  }
  /** Feed one frame's RMS; returns a transition event or null. */
  feed(level: number): VadEvent {
    const voiced = level > this.threshold;
    if (!this.speaking) {
      if (!voiced) this.noise = this.noise * 0.97 + level * 0.03; // adapt only on non-speech
      this.voicedRun = voiced ? this.voicedRun + 1 : 0;
      if (this.voicedRun >= this.o.startFrames) {
        this.speaking = true;
        this.silentRun = 0;
        this.speakingFrames = this.voicedRun;
        return { type: "start" };
      }
      return null;
    }
    this.speakingFrames++;
    this.silentRun = voiced ? 0 : this.silentRun + 1;
    if (this.silentRun * this.o.frameMs >= this.o.silenceMs) {
      this.speaking = false;
      this.voicedRun = 0;
      return { type: "end", reason: "silence" };
    }
    if (this.speakingFrames * this.o.frameMs >= this.o.maxUtteranceMs) {
      // keep `speaking` true: the next utterance starts immediately
      this.speakingFrames = 0;
      return { type: "end", reason: "cap" };
    }
    return null;
  }
  reset() {
    this.speaking = false;
    this.voicedRun = this.silentRun = this.speakingFrames = 0;
  }
}
