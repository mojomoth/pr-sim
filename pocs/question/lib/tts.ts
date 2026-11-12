import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gemini, openai } from "@/lib/ai";
import type { Temperament } from "@/lib/types";
import { resolveVoice, styleFor, ttsPrompt } from "@/stt-tts/lib/persona";
import { plausibleDuration, ProviderError, synthesizeSpeech, TTS_MODELS } from "@/stt-tts/lib/server";
import { isWav, pcm16ToWav, rateFromMime, wavInfo } from "@/stt-tts/lib/wav";
import { classify, downReason, isAbort, markDown } from "./providers";
import { DATA_DIR } from "./store";

// Judge voice = stt-tts synthesizeSpeech (Gemini TTS, persona → voice/style, disk cache).
// The Gemini free tier allows ~10 TTS requests/day per model; once every model in its chain is
// exhausted (429 with a multi-hour retry), we fall back to OpenAI gpt-4o-mini-tts with the SAME
// persona style instructions so the Q&A flow keeps its voice. Local to this PoC (stt-tts untouched).

export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const OPENAI_VOICES: Record<"male" | "female", Record<Temperament, string>> = {
  male: { friendly: "cedar", strict: "onyx", aggressive: "ash" },
  female: { friendly: "coral", strict: "sage", aggressive: "marin" },
};

export interface JudgeSpeech {
  wav: Buffer;
  provider: "gemini" | "openai";
  voice: string;
  model?: string;
  cached: boolean;
  durationSec?: number;
  fallbackReason?: string;
}

function wavDuration(buf: Buffer): number | undefined {
  // PCM WAV: byteRate at offset 28, data chunk size → seconds
  if (buf.subarray(0, 4).toString() !== "RIFF") return undefined;
  const byteRate = buf.readUInt32LE(28);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.subarray(off, off + 4).toString();
    let size = buf.readUInt32LE(off + 4);
    if (id === "data") {
      if (size === 0 || size === 0xffffffff || off + 8 + size > buf.length) size = buf.length - off - 8; // streamed WAV header
      return byteRate ? Math.round((size / byteRate) * 100) / 100 : undefined;
    }
    off += 8 + size;
  }
  return undefined;
}

/**
 * Chain: stt-tts synthesizeSpeech (Gemini, its own model fallback + cooldowns)
 *   → on 429: a direct Gemini retry here (stt-tts keeps multi-hour cooldowns in memory after a daily-quota
 *     429; once the quota resets those cooldowns are stale until the dev server restarts — verified
 *     2026-11-12: every TTS model answered 200 while stt-tts still refused)
 *   → OpenAI gpt-4o-mini-tts (skipped while OpenAI is marked down, e.g. credits gone).
 * Throws a ProviderError with a short Korean message when everything fails.
 */
export async function judgeSpeech(text: string, p: { gender: "male" | "female"; age: number; temperament: Temperament }): Promise<JudgeSpeech> {
  let first: unknown;
  try {
    const r = await synthesizeSpeech(text, p);
    return { wav: r.wav, provider: "gemini", voice: r.voice, model: r.model, cached: !!r.cached, durationSec: r.durationSec };
  } catch (e) {
    const quota = e instanceof ProviderError && e.status === 429;
    if (!quota || process.env.QUESTION_TTS_FALLBACK === "off") throw e;
    first = e;
  }
  const reasons: string[] = ["Gemini TTS 한도"];
  try {
    return await geminiDirectSpeech(text, p);
  } catch (e) {
    if (isAbort(e)) throw e;
    console.warn("[question] direct Gemini TTS failed:", e instanceof Error ? e.message.slice(0, 120) : e);
  }
  const off = downReason("openai");
  if (!off) {
    try {
      return await openaiSpeech(text, p, (first as Error).message);
    } catch (e) {
      const c = classify("openai", e);
      if (c.kind === "billing") markDown("openai", c.short);
      reasons.push(`OpenAI ${c.short}`);
    }
  } else reasons.push(`OpenAI ${off}`);
  throw new ProviderError(`심사위원 음성을 만들 수 없습니다 (${reasons.join(" · ")}). 질문은 텍스트로 진행하세요.`, 503);
}

const gCool = ((globalThis as unknown as { __questionTtsCool?: Map<string, number> }).__questionTtsCool ??= new Map());

/** Same voice/style/prompt as stt-tts (exported helpers), own cooldowns and cache. */
async function geminiDirectSpeech(text: string, p: { gender: "male" | "female"; age: number; temperament: Temperament }): Promise<JudgeSpeech> {
  const { voice, style } = resolveVoice({ gender: p.gender, age: Math.round(Math.min(70, Math.max(20, p.age))), temperament: p.temperament });
  const line = text.trim().slice(0, 1200);
  const key = createHash("sha256").update(JSON.stringify(["gemini", voice, style, line])).digest("hex").slice(0, 24);
  const file = path.join(DATA_DIR, "tts", `g-${key}.wav`);
  try {
    const wav = await readFile(file);
    return { wav, provider: "gemini", voice, model: "cache", cached: true, durationSec: wavDuration(wav) };
  } catch {
    /* miss */
  }
  let last: unknown = new Error("no Gemini TTS model available");
  for (const model of TTS_MODELS) {
    if ((gCool.get(model) ?? 0) > Date.now()) continue;
    try {
      const res = await gemini().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: ttsPrompt(line, style) }] }],
        config: { httpOptions: { apiVersion: "v1beta", timeout: 45_000 }, responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      });
      const part = res.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
      if (!part?.inlineData?.data) throw new Error(`no audio (${res.candidates?.[0]?.finishReason ?? "unknown"})`);
      const raw = new Uint8Array(Buffer.from(part.inlineData.data, "base64"));
      const bytes = isWav(raw) ? raw : pcm16ToWav(raw, rateFromMime(part.inlineData.mimeType, 24000));
      const durationSec = Math.round((wavInfo(bytes)?.durationSec ?? 0) * 100) / 100;
      if (!plausibleDuration(line, durationSec)) throw new Error(`implausible duration ${durationSec}s`);
      const wav = Buffer.from(bytes);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, wav);
      return { wav, provider: "gemini", voice, model, cached: false, durationSec, fallbackReason: "stt-tts-cooldown" };
    } catch (e) {
      last = e;
      const st = (e as { status?: number }).status;
      if (st === 429) gCool.set(model, Date.now() + 10 * 60_000);
      else if (st === 404 || st === 400) gCool.set(model, Date.now() + 3600_000);
    }
  }
  throw last;
}

async function openaiSpeech(text: string, p: { gender: "male" | "female"; age: number; temperament: Temperament }, reason: string): Promise<JudgeSpeech> {
  const voice = OPENAI_VOICES[p.gender][p.temperament];
  const instructions = styleFor({ gender: p.gender, age: Math.min(70, Math.max(20, p.age)), temperament: p.temperament });
  const line = text.trim().slice(0, 1200);
  const key = createHash("sha256").update(JSON.stringify([OPENAI_TTS_MODEL, voice, instructions, line])).digest("hex").slice(0, 24);
  const file = path.join(DATA_DIR, "tts", `${key}.wav`);
  try {
    const wav = await readFile(file);
    return { wav, provider: "openai", voice, model: OPENAI_TTS_MODEL, cached: true, durationSec: wavDuration(wav), fallbackReason: "gemini-quota" };
  } catch {
    /* miss */
  }
  const res = await openai().audio.speech.create({ model: OPENAI_TTS_MODEL, voice, input: line, instructions, response_format: "wav" });
  const wav = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, wav);
  console.warn(`[question] Gemini TTS quota → OpenAI ${voice} (${reason.slice(0, 60)})`);
  return { wav, provider: "openai", voice, model: OPENAI_TTS_MODEL, cached: false, durationSec: wavDuration(wav), fallbackReason: "gemini-quota" };
}
