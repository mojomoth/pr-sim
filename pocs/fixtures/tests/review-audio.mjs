import { readFile } from "node:fs/promises";
const buf = await readFile("fixtures/audio/speech-ko.wav");
// parse header
const fmt = buf.toString("ascii", 0, 4) + "/" + buf.toString("ascii", 8, 12);
let off = 12, dataOff = 0, dataLen = 0, sr = 0;
while (off < buf.length) { const id = buf.toString("ascii", off, off+4); const len = buf.readUInt32LE(off+4); if (id === "fmt ") sr = buf.readUInt32LE(off+12); if (id === "data") { dataOff = off+8; dataLen = len; break; } off += 8 + len; }
console.log(fmt, "sr", sr, "dataLen", dataLen, "riffLen ok", buf.readUInt32LE(4) === buf.length - 8);
const n = dataLen / 2; const rms = (a, b) => { let s = 0, c = 0; for (let i = Math.floor(a*sr); i < Math.min(n, Math.floor(b*sr)); i++) { const v = buf.readInt16LE(dataOff + i*2) / 32768; s += v*v; c++; } return Math.sqrt(s / Math.max(c,1)); };
const t = JSON.parse(await readFile("fixtures/audio/speech-ko.timing.json", "utf8"));
console.log("lead rms", rms(0, 0.45).toFixed(4));
for (const s of t.sentences) console.log(s.i, "speech rms", rms(s.start, s.end).toFixed(4), "gap after rms", rms(s.end + 0.05, s.end + 0.75).toFixed(4));
let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf.readInt16LE(dataOff + i*2))); console.log("peak", peak);
