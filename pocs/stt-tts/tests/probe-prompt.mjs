// Probe the TTS prompt layout per model (bypasses cache). usage: node stt-tts/tests/probe-prompt.mjs <model> <gender> <age> <temperament>
import { GoogleGenAI } from "@google/genai";
import { readFileSync, writeFileSync } from "node:fs";
import { resolveVoice, ttsPrompt, SAMPLE_QUESTIONS } from "../lib/persona.ts";
for (const l of readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, ""); }
const [model = "gemini-3.8-flash-lite-tts", gender = "male", age = "28", temperament = "strict"] = process.argv.slice(2);
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const { voice, style } = resolveVoice({ gender, age: Number(age), temperament });
const t0 = Date.now();
const r = await ai.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: ttsPrompt(SAMPLE_QUESTIONS[temperament], style) }] }],
  config: { httpOptions: { apiVersion: "v1beta", timeout: 45000 }, responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } });
const d = r.candidates[0].content.parts[0].inlineData;
const buf = Buffer.from(d.data, "base64");
const f = `.verify/stt-tts/probe-${model}-${gender}-${age}-${temperament}.wav`; writeFileSync(f, buf);
console.log(model, voice, d.mimeType, ((buf.length - 44) / 48000).toFixed(2) + "s", Date.now() - t0 + "ms", f);
