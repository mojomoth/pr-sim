// ONE real Gemini Live STT run: ephemeral token with inputAudioTranscription.customVocabulary locked in,
// first ~25s of pocs/fixtures/audio/speech-ko-16k.wav streamed in real time. Prints transcripts only.
import { readFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-transcribe-live";
const vocab = (process.argv[3] ?? "").split(",").filter(Boolean);
const CONFIG = { inputAudioTranscription: { languageCodes: ["ko-KR"], ...(vocab.length ? { customVocabulary: vocab } : {}) } };
const server = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const tok = await server.authTokens.create({
  config: {
    httpOptions: { apiVersion: "v1alpha" },
    uses: 1,
    expireTime: new Date(Date.now() + 5 * 60_000).toISOString(),
    newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
    liveConnectConstraints: { model: MODEL, config: CONFIG },
  },
});
console.log("token minted:", !!tok.name, "config:", JSON.stringify(CONFIG));
const wav = readFileSync(process.argv[2]);
const pcm = wav.subarray(44, 44 + 16000 * 2 * 25); // 16k mono s16le, 25s
const ai = new GoogleGenAI({ apiKey: tok.name, httpOptions: { apiVersion: "v1alpha" } });
const finals = [];
let closed;
const done = new Promise((r) => (closed = r));
const sess = await ai.live.connect({
  model: MODEL,
  config: CONFIG,
  callbacks: {
    onopen: () => console.log("open"),
    onmessage: (m) => {
      const t = m.serverContent?.inputTranscription?.text;
      if (t) finals.push(t);
    },
    onerror: (e) => console.log("error", e?.message),
    onclose: (e) => { console.log("close", e.code, e.reason); closed(); },
  },
});
const CH = 3200; // 100ms
for (let i = 0; i < pcm.length; i += CH) {
  sess.sendRealtimeInput({ audio: { data: Buffer.from(pcm.subarray(i, i + CH)).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
  await new Promise((r) => setTimeout(r, 100));
}
const silence = Buffer.alloc(CH);
for (let i = 0; i < 20; i++) { sess.sendRealtimeInput({ audio: { data: silence.toString("base64"), mimeType: "audio/pcm;rate=16000" } }); await new Promise((r) => setTimeout(r, 100)); }
await new Promise((r) => setTimeout(r, 2500));
sess.close();
await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
console.log("transcript:", finals.join(""));
