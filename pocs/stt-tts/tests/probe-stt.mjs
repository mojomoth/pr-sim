import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, ""); }
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const file = process.argv[2]; const variant = process.argv[3] ?? "a";
const data = readFileSync(file).toString("base64");
const t0 = Date.now();
try {
  const cfg = { httpOptions: { apiVersion: process.argv[4] ?? "v1beta" } };
  if (variant === "a") cfg.audioTranscriptionConfig = { languageCodes: ["ko-KR"] };
  const parts = [{ inlineData: { mimeType: "audio/wav", data } }];
  if (variant === "p") parts.push({ text: "Transcribe in Korean." });
  const r = await ai.models.generateContent({ model: "gemini-3.5-transcribe", contents: [{ role: "user", parts }], config: cfg });
  console.log(Date.now() - t0, "ms");
  console.log(JSON.stringify(r.candidates?.[0]?.content, null, 1).slice(0, 2500));
  console.log("usage", JSON.stringify(r.usageMetadata));
} catch (e) { console.log("ERR", String(e.message).slice(0, 800)); }
