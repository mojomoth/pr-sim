#!/usr/bin/env node
// TTS → STT round trip for judge voices (checks the audio really speaks the question). OpenAI transcribe
// is used for checking because the Gemini transcribe free quota is shared with the STT PoC.
// usage: node --env-file=.env.local question/tests/tts-roundtrip.mjs file.wav "expected text" ...
import OpenAI from "openai";
import { createReadStream } from "node:fs";
const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const r = await oa.audio.transcriptions.create({ model: "gpt-4o-mini-transcribe", file: createReadStream(args[i]), language: "ko" });
  const norm = (s) => s.replace(/[^0-9가-힣A-Za-z]/g, "");
  const a = norm(args[i + 1]), b = norm(r.text);
  let same = 0;
  for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] === b[k]) same++;
  console.log(JSON.stringify({ file: args[i], heard: r.text, positionalCharMatch: +(same / Math.max(a.length, 1)).toFixed(3) }));
}
