// TTS output → Live STT (via our ephemeral-token route) → character accuracy.
// usage: node stt-tts/tests/roundtrip-live.mjs  (reads .verify/stt-tts/wav/*.wav + tts-matrix.json)
import { GoogleGenAI } from "@google/genai";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const SAMPLES = {
  friendly: "발표 잘 들었습니다. 이 서비스를 처음 떠올리게 된 계기를 조금 더 들려주실 수 있을까요?",
  strict: "핵심 지표부터 확인하겠습니다. 월간 활성 사용자 목표치와 그 근거 데이터를 구체적으로 말씀해 주세요.",
  aggressive: "솔직히 말씀드리면 경쟁 서비스와 차이가 보이지 않습니다. 왜 굳이 이 서비스를 써야 합니까?",
};
const norm = (s) => s.replace(/[\s.,!?·…"'“”‘’]/g, "");
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
async function liveTranscribe(pcm16k) {
  const tok = await fetch(`${BASE}/api/stt-tts/token`, { method: "POST", headers: { origin: BASE } }).then((r) => r.json());
  const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: "v1alpha" } });
  const finals = [];
  let done; const closed = new Promise((r) => (done = r));
  const s = await ai.live.connect({ model: tok.model, config: tok.config, callbacks: {
    onmessage: (m) => { const t = m.serverContent?.inputTranscription?.text; if (t) finals.push(t); },
    onclose: () => done(), onerror: () => done(),
  } });
  const silence = Buffer.alloc(3200);
  const chunks = [];
  for (let o = 0; o < pcm16k.length; o += 3200) chunks.push(pcm16k.subarray(o, o + 3200));
  for (let i = 0; i < 20; i++) chunks.push(silence); // 2s trailing silence → server VAD closes the turn
  for (const c of chunks) { s.sendRealtimeInput({ audio: { data: c.toString("base64"), mimeType: "audio/pcm;rate=16000" } }); await new Promise((r) => setTimeout(r, 50)); } // 2x realtime
  await new Promise((r) => setTimeout(r, 2500));
  s.close(); await closed;
  return finals.join(" ");
}
const matrix = JSON.parse(readFileSync(".verify/stt-tts/tts-matrix.json", "utf8"));
const rows = [];
for (const f of readdirSync(".verify/stt-tts/wav").filter((x) => x.endsWith(".wav")).sort()) {
  const [gender, age, temperament] = f.replace(".wav", "").split("-");
  const pcm = execFileSync("ffmpeg", ["-loglevel", "error", "-i", `.verify/stt-tts/wav/${f}`, "-ar", "16000", "-ac", "1", "-f", "s16le", "-"], { maxBuffer: 64 << 20 });
  const t0 = Date.now();
  const text = await liveTranscribe(pcm);
  const ref = norm(SAMPLES[temperament]);
  const acc = Math.round((1 - lev(ref, norm(text)) / ref.length) * 1000) / 10;
  const m = matrix.rows.find((r) => r.gender === gender && String(r.age) === age && r.temperament === temperament);
  const row = { file: f, voice: m?.voice, model: m?.model, durationSec: m?.durationSec, ttsServerMs: m?.serverMs, charAccuracy: acc, ms: Date.now() - t0, text };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const avg = Math.round((rows.reduce((a, r) => a + r.charAccuracy, 0) / rows.length) * 10) / 10;
writeFileSync(".verify/stt-tts/roundtrip-live.json", JSON.stringify({ avgCharAccuracy: avg, rows }, null, 2));
console.log("AVG charAccuracy", avg, "n", rows.length);
