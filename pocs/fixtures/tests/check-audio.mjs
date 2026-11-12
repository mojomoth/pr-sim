// Round-trip check of the audio fixtures with OpenAI STT (gpt-4o-mini-transcribe) — spares the Gemini Free Tier quota.
// Run from pocs/: node --env-file=.env.local fixtures/tests/check-audio.mjs
import OpenAI, { toFile } from "openai";
import { readFileSync } from "node:fs";
const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
for (const f of ["fixtures/audio/speech-ko-16k.wav", "fixtures/audio/answer-ko-16k.wav"]) {
  const t0 = Date.now();
  const r = await oai.audio.transcriptions.create({ model: "gpt-4o-mini-transcribe", language: "ko", file: await toFile(readFileSync(f), f.split("/").pop()) });
  console.log(`${f} (${Date.now() - t0}ms):\n  ${r.text}`);
}
