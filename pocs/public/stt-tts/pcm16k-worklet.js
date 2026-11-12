// AudioWorklet: mic (any rate) -> mono Float32 @16kHz, posted in 20ms frames (320 samples).
// One-pole low-pass (~7kHz) before linear-interpolation resampling to limit aliasing.
class Pcm16kProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0; // fractional read position into [last, ...block]
    this.last = 0;
    this.lp = 0;
    this.alpha = 1 - Math.exp((-2 * Math.PI * 7000) / sampleRate);
    this.frame = new Float32Array(320);
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const len = input[0].length;
    const data = new Float32Array(len + 1);
    data[0] = this.last;
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let c = 0; c < input.length; c++) s += input[c][i];
      s /= input.length;
      this.lp += this.alpha * (s - this.lp);
      data[i + 1] = this.lp;
    }
    let pos = this.pos;
    while (pos < len) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      this.frame[this.n++] = data[idx] * (1 - frac) + data[idx + 1] * frac;
      if (this.n === 320) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(320);
        this.n = 0;
      }
      pos += this.ratio;
    }
    this.pos = pos - len;
    this.last = data[len];
    return true;
  }
}
registerProcessor("pcm16k", Pcm16kProcessor);
