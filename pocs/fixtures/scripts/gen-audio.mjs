// Generates Korean speech fixtures with Gemini TTS (gemini-3.8-flash-tts).
// Note: this TTS model needs the v1beta endpoint (default endpoint rejects speechConfig).
// Run from pocs/:  node --env-file=.env.local fixtures/scripts/gen-audio.mjs [--provider gemini|openai]
// Output: fixtures/audio/speech-ko.wav (first 8 script sentences, 0.8s gaps), answer-ko.wav (~15s answer),
//         plus 16 kHz mono variants (*-16k.wav) for Chrome --use-file-for-fake-audio-capture,
//         and speech-ko.timing.json (sentence start/end seconds inside speech-ko.wav).
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// --provider gemini (default, gemini-3.8-flash-tts) | openai (gpt-4o-mini-tts, used on 2026-11-12 because the
// Gemini Free Tier TTS quota of 10 requests/day was exhausted).
const PROVIDER = process.argv.includes("--provider") ? process.argv[process.argv.indexOf("--provider") + 1] : "gemini";
const MODEL = PROVIDER === "openai" ? "gpt-4o-mini-tts" : "gemini-3.8-flash-tts";
const VOICE = "Kore"; // Gemini voice for presenter 김서연 (female, calm/firm); OpenAI uses "coral"
const DIR = join(process.cwd(), "fixtures", "audio");
mkdirSync(DIR, { recursive: true });
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export const ANSWER_QUESTION = "원가가 기존 포장재보다 높은데 어떻게 경쟁하나요?";
export const ANSWER_TEXT =
  "네, 지금 원가가 스티로폼보다 높은 건 맞습니다. 다만 저희 원료는 처리비를 받고 수거하는 수산 부산물이라서, 내년 3분기에 2공장이 가동되면 2028년에는 세트당 92원까지 낮출 수 있습니다.";

const oai = PROVIDER === "openai" ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

async function tts(text) {
  const t0 = Date.now();
  if (oai) {
    const res = await oai.audio.speech.create({
      model: MODEL,
      voice: "coral",
      input: text,
      instructions: "한국 스타트업 대표가 투자자 앞에서 발표하는 차분하고 자신감 있는 여성 목소리. 자연스러운 속도로.",
      response_format: "pcm", // raw s16le 24 kHz mono
    });
    const pcm = Buffer.from(await res.arrayBuffer());
    console.log(`  tts ${text.slice(0, 24)}… ${(pcm.length / 2 / 24000).toFixed(2)}s audio in ${Date.now() - t0}ms (openai pcm)`);
    return { pcm, rate: 24000 };
  }
  const r = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text }] }],
    config: { httpOptions: { apiVersion: "v1beta" }, responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
  });
  const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error("no audio in response: " + JSON.stringify(r).slice(0, 300));
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24000);
  let pcm = Buffer.from(part.inlineData.data, "base64");
  if (pcm.subarray(0, 4).toString() === "RIFF") pcm = pcm.subarray(44); // some models already return WAV
  console.log(`  tts ${text.slice(0, 24)}… ${(pcm.length / 2 / rate).toFixed(2)}s audio in ${Date.now() - t0}ms (${part.inlineData.mimeType})`);
  return { pcm, rate };
}

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function to16k(src, dst) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", dst]);
}

const ONLY_ANSWER = process.argv.includes("--answer-only");
const sentences = ONLY_ANSWER ? [] : readFileSync(join(process.cwd(), "fixtures", "presentation-script.txt"), "utf8").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 8);
if (!ONLY_ANSWER) {
console.log(`speech: ${sentences.length} sentences`);
const clips = [];
for (const s of sentences) clips.push(await tts(s)); // sequential: avoids burning a whole daily quota on one failure
const rate = clips[0].rate;
const gap = Buffer.alloc(Math.round(rate * 0.8) * 2);
const lead = Buffer.alloc(Math.round(rate * 0.5) * 2);
const parts = [lead];
const timing = [];
let pos = lead.length / 2 / rate;
clips.forEach((c, i) => {
  if (c.rate !== rate) throw new Error("mixed sample rates");
  const dur = c.pcm.length / 2 / rate;
  timing.push({ i, start: +pos.toFixed(2), end: +(pos + dur).toFixed(2), text: sentences[i] });
  parts.push(c.pcm, gap);
  pos += dur + 0.8;
});
writeFileSync(join(DIR, "speech-ko.wav"), wav(Buffer.concat(parts), rate));
writeFileSync(join(DIR, "speech-ko.timing.json"), JSON.stringify({ sampleRate: rate, gapSeconds: 0.8, leadSeconds: 0.5, sentences: timing }, null, 2));
to16k(join(DIR, "speech-ko.wav"), join(DIR, "speech-ko-16k.wav"));
}

console.log("answer:");
const ans = await tts(ANSWER_TEXT);
writeFileSync(join(DIR, "answer-ko.wav"), wav(Buffer.concat([Buffer.alloc(Math.round(ans.rate * 0.5) * 2), ans.pcm, Buffer.alloc(Math.round(ans.rate * 0.8) * 2)]), ans.rate));
writeFileSync(join(DIR, "answer-ko.txt"), `Q: ${ANSWER_QUESTION}\nA: ${ANSWER_TEXT}\n`);
to16k(join(DIR, "answer-ko.wav"), join(DIR, "answer-ko-16k.wav"));
console.log("done");
