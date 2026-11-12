// Median F0 (autocorrelation) + speaking rate per generated persona clip → evidence that voices differ.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const rt = JSON.parse(readFileSync(".verify/stt-tts/roundtrip-live.json", "utf8"));
const out = [];
for (const f of readdirSync(".verify/stt-tts/wav").filter((x) => x.endsWith(".wav")).sort()) {
  const buf = execFileSync("ffmpeg", ["-loglevel", "error", "-i", `.verify/stt-tts/wav/${f}`, "-ar", "16000", "-ac", "1", "-f", "s16le", "-"], { maxBuffer: 64 << 20 });
  const x = new Float32Array(buf.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = buf.readInt16LE(i * 2) / 32768;
  const N = 640, f0s = [];
  let voicedFrames = 0;
  for (let o = 0; o + N < x.length; o += 320) {
    let e = 0; for (let i = 0; i < N; i++) e += x[o + i] ** 2;
    if (Math.sqrt(e / N) < 0.02) continue;
    voicedFrames++;
    let best = 0, lag = 0;
    for (let L = 16000 / 400; L <= 16000 / 60; L++) { let c = 0; for (let i = 0; i < N - L; i++) c += x[o + i] * x[o + i + L]; if (c > best) { best = c; lag = L; } }
    if (lag && best / e > 0.4) f0s.push(16000 / lag);
  }
  f0s.sort((a, b) => a - b);
  const r = rt.rows.find((q) => q.file === f);
  const chars = (r?.text ?? "").replace(/\s/g, "").length;
  out.push({ persona: f.replace(".wav", ""), voice: r?.voice, model: r?.model, durationSec: r?.durationSec, medianF0Hz: Math.round(f0s[Math.floor(f0s.length / 2)] ?? 0), charsPerSec: Math.round((chars / (voicedFrames * 0.02 || 1)) * 10) / 10 });
}
console.table(out);
writeFileSync(".verify/stt-tts/voice-stats.json", JSON.stringify(out, null, 2));
