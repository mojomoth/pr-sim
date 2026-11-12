// Probe: which prebuilt voice names work with the TTS model, and output format.
import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, ""); }
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const voices = process.argv.slice(2);
await Promise.all(voices.map(async (v) => {
  const t0 = Date.now();
  try {
    const r = await ai.models.generateContent({
      model: "gemini-3.8-flash-tts",
      contents: [{ role: "user", parts: [{ text: "따뜻하게 말하세요: 안녕하세요, 발표 잘 들었습니다." }] }],
      config: { httpOptions: { apiVersion: "v1beta" }, responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } },
    });
    const p = r.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    console.log(v, "OK", p?.mimeType, Math.round((p?.data?.length ?? 0) * 0.75), "bytes", Date.now() - t0, "ms");
  } catch (e) { console.log(v, "ERR", String(e.message).slice(0, 1500)); }
}));
