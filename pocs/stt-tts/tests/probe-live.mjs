// Probe (A): ephemeral token + Live transcription with gemini-3.5-transcribe-live
import { GoogleGenAI, Modality } from "@google/genai";
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, ""); }
const MODEL = process.argv[3] ?? "gemini-3.5-transcribe-live";
const server = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY, httpOptions: { apiVersion: "v1alpha" } });
const exp = new Date(Date.now() + 30 * 60e3).toISOString();
let token;
try {
  token = await server.authTokens.create({ config: { uses: 1, expireTime: exp, newSessionExpireTime: new Date(Date.now() + 60e3).toISOString(),
    liveConnectConstraints: { model: MODEL, config: { inputAudioTranscription: { languageCodes: ["ko-KR"] } } } } });
  console.log("token ok", token.name?.slice(0, 12) + "…");
} catch (e) { console.log("TOKEN ERR", String(e.message).slice(0, 600)); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion: "v1alpha" } });
const wav = readFileSync(process.argv[2]); const pcm = wav.subarray(44);
const t0 = Date.now(); const ts = () => ((Date.now() - t0) / 1000).toFixed(2);
let done;
const closed = new Promise((r) => (done = r));
const cfgVariant = process.argv[4] ?? "t";
const config = cfgVariant === "t" ? { inputAudioTranscription: { languageCodes: ["ko-KR"] } } : { responseModalities: [Modality.TEXT], inputAudioTranscription: {} };
const session = await ai.live.connect({ model: MODEL, config, callbacks: {
  onopen: () => console.log(ts(), "open"),
  onmessage: (m) => { const s = JSON.stringify(m); console.log(ts(), s.length > 400 ? s.slice(0, 400) + "…" : s); },
  onerror: (e) => console.log(ts(), "error", e.message ?? e.error),
  onclose: (e) => { console.log(ts(), "close", e.code, e.reason); done(); },
} });
// stream real-time: 100ms chunks (3200 bytes)
for (let o = 0; o < pcm.length; o += 3200) {
  session.sendRealtimeInput({ audio: { data: pcm.subarray(o, o + 3200).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
  await new Promise((r) => setTimeout(r, 100));
}
console.log(ts(), "audio sent");
session.sendRealtimeInput({ audioStreamEnd: true });
setTimeout(() => session.close(), 5000);
await closed;
