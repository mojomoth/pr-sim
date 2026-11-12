// 2 genders × 3 temperaments × 2 ages via /api/stt-tts/tts, then TTS→STT round trip (char accuracy).
// usage: node stt-tts/tests/tts-matrix.mjs   (writes .verify/stt-tts/tts-matrix.json + wavs)
import { writeFileSync, mkdirSync } from "node:fs";
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
mkdirSync(".verify/stt-tts/wav", { recursive: true });
const rows = [];
for (const gender of ["male", "female"]) for (const temperament of ["friendly", "strict", "aggressive"]) for (const age of [28, 58]) {
  const text = SAMPLES[temperament];
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/stt-tts/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, gender, age, temperament }) });
  const row = { gender, age, temperament, status: res.status, clientMs: Date.now() - t0 };
  if (!res.ok) { row.error = (await res.json().catch(() => ({}))).error; rows.push(row); console.log(row); continue; }
  const wav = Buffer.from(await res.arrayBuffer());
  Object.assign(row, { voice: res.headers.get("x-voice"), model: res.headers.get("x-model"), cache: res.headers.get("x-cache"), durationSec: Number(res.headers.get("x-duration")), serverMs: Number(res.headers.get("x-ms")), bytes: wav.length });
  const f = `.verify/stt-tts/wav/${gender}-${age}-${temperament}.wav`;
  writeFileSync(f, wav);
  const s0 = Date.now();
  const tr = await fetch(`${BASE}/api/stt-tts/transcribe`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav }).then((r) => r.json());
  row.sttMs = Date.now() - s0;
  row.transcript = tr.text ?? tr.error;
  const ref = norm(text), hyp = norm(tr.text ?? "");
  row.charAccuracy = Math.round((1 - lev(ref, hyp) / ref.length) * 1000) / 10;
  row.sentences = tr.sentences?.length;
  rows.push(row);
  console.log(JSON.stringify({ ...row, transcript: undefined }));
}
const ok = rows.filter((r) => r.charAccuracy != null);
const summary = {
  combos: rows.length,
  ok: ok.length,
  distinctVoices: new Set(ok.map((r) => r.voice)).size,
  avgCharAccuracy: Math.round((ok.reduce((a, r) => a + r.charAccuracy, 0) / (ok.length || 1)) * 10) / 10,
  ttsMsFresh: ok.filter((r) => r.cache === "MISS").map((r) => r.serverMs),
  models: [...new Set(ok.map((r) => r.model))],
};
writeFileSync(".verify/stt-tts/tts-matrix.json", JSON.stringify({ summary, rows }, null, 2));
console.log("SUMMARY", JSON.stringify(summary));
