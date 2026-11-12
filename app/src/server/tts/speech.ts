import "server-only";
import { gemini, MODELS, openai } from "../ai";
import { ApiError } from "../http";
import type { Gender, Temperament } from "../types";
import { resolveVoice, styleFor, ttsPrompt, type VoicePersona } from "./persona";
import { isWav, pcm16ToWav, rateFromMime, wavInfo } from "./wav";

// Judge voice. The chain (report.md D7) is walked ONCE per request, with no waiting on cooldowns (D8):
//   gemini-3.8-flash-tts → gemini-3.8-flash-lite-tts → OpenAI gpt-4o-mini-tts (same persona style as instructions).
// A Gemini model that answered 429 is skipped for a few minutes only (U8: long cooldowns outlived the quota reset).
// `provider: "openai"` pins the voice to OpenAI once a session has fallen back, so the voice stays the same.

const OPENAI_VOICES: Record<Gender, Record<Temperament, string>> = {
  male: { friendly: "cedar", strict: "onyx", aggressive: "ash" },
  female: { friendly: "coral", strict: "sage", aggressive: "marin" },
};

const COOLDOWN_MS = { quota: 5 * 60_000, other: 60_000 };
const cooldownUntil = new Map<string, number>();
/** Models whose current cooldown came from a quota error, so a skipped model still reports "used up for today". */
const quotaCooldown = new Set<string>();

export interface SpeechResult {
  wav: Uint8Array;
  provider: "gemini" | "openai";
  model: string;
  voice: string;
  durationSec: number;
}

/**
 * Korean read speech is ~0.12–0.2 s per character. Far longer means the model spoke more than the line
 * (seen: flash-lite reading the director's notes aloud), far shorter means it was cut off.
 */
function plausibleDuration(text: string, sec: number): boolean {
  const chars = text.replace(/\s/g, "").length;
  return sec >= Math.min(0.6, chars * 0.04) && sec <= 3 + chars * 0.3;
}

const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown })?.status;
  if (typeof s === "number") return s;
  const m = String((e as Error)?.message ?? "").match(/"code":\s*(\d{3})/);
  return m ? Number(m[1]) : undefined;
};

async function geminiSpeech(model: string, line: string, voice: string, style: string, timeoutMs: number): Promise<SpeechResult> {
  const res = await gemini().models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: ttsPrompt(line, style) }] }],
    config: {
      // the SDK defaults to /v1, where speechConfig is rejected
      httpOptions: { apiVersion: "v1beta", timeout: timeoutMs },
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const part = res.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error(`no audio (${res.candidates?.[0]?.finishReason ?? "unknown"})`);
  const raw = new Uint8Array(Buffer.from(part.inlineData.data, "base64"));
  // older models return raw PCM s16le 24kHz; 3.8 models already send WAV
  const wav = isWav(raw) ? raw : pcm16ToWav(raw, rateFromMime(part.inlineData.mimeType, 24000));
  const durationSec = Math.round((wavInfo(wav)?.durationSec ?? 0) * 100) / 100;
  if (!plausibleDuration(line, durationSec)) throw new Error(`implausible duration ${durationSec}s`);
  return { wav, provider: "gemini", model, voice, durationSec };
}

async function openaiSpeech(line: string, p: VoicePersona, timeoutMs: number): Promise<SpeechResult> {
  const voice = OPENAI_VOICES[p.gender][p.temperament];
  const res = await openai().audio.speech.create(
    { model: MODELS.openaiTts, voice, input: line, instructions: styleFor(p), response_format: "wav" },
    { timeout: timeoutMs, maxRetries: 1 },
  );
  const wav = new Uint8Array(await res.arrayBuffer());
  return { wav, provider: "openai", model: MODELS.openaiTts, voice, durationSec: Math.round((wavInfo(wav)?.durationSec ?? 0) * 100) / 100 };
}

export async function synthesizeSpeech(
  text: string,
  persona: { gender: Gender; age: number; temperament: Temperament },
  opts: { provider?: "gemini" | "openai"; deadline?: number } = {},
): Promise<SpeechResult> {
  const p: VoicePersona = { ...persona, age: Math.round(Math.min(70, Math.max(20, persona.age))) };
  const line = text.trim().slice(0, 1200);
  const deadline = opts.deadline ?? Date.now() + 55_000;
  const left = () => deadline - Date.now();
  const reasons: string[] = [];
  let quota = false;

  if (opts.provider !== "openai") {
    const { voice, style } = resolveVoice(p);
    for (const model of MODELS.geminiTts) {
      if ((cooldownUntil.get(model) ?? 0) > Date.now()) {
        if (quotaCooldown.has(model)) quota = true;
        reasons.push(`${model} cooldown`);
        continue;
      }
      if (left() < 8_000) break;
      try {
        return await geminiSpeech(model, line, voice, style, Math.min(20_000, left() - 6_000));
      } catch (e) {
        const st = statusOf(e);
        if (st === 429) quota = true;
        if (st === 429) quotaCooldown.add(model);
        else quotaCooldown.delete(model);
        cooldownUntil.set(model, Date.now() + (st === 429 ? COOLDOWN_MS.quota : st === 404 || (st && st >= 500) ? COOLDOWN_MS.other : 0));
        reasons.push(`${model} ${st ?? (e as Error)?.name ?? "error"}`);
      }
    }
  }
  if (opts.provider !== "gemini" && left() > 3_000) {
    if ((cooldownUntil.get(MODELS.openaiTts) ?? 0) > Date.now()) reasons.push(`${MODELS.openaiTts} cooldown`);
    else {
      try {
        return await openaiSpeech(line, p, Math.min(30_000, left() - 1_000));
      } catch (e) {
        const st = statusOf(e);
        const code = (e as { code?: unknown })?.code;
        // no credits left (429 insufficient_quota / credit_balance_exhausted) will not clear within a session: fail fast for a while
        if (st === 429 && /quota|credit/i.test(`${code ?? ""} ${(e as { type?: unknown })?.type ?? ""}`)) cooldownUntil.set(MODELS.openaiTts, Date.now() + COOLDOWN_MS.quota);
        reasons.push(`${MODELS.openaiTts} ${st ?? (e as Error)?.name ?? "error"}${typeof code === "string" ? ` ${code}` : ""}`);
      }
    }
  }
  console.warn("[tts] every voice model failed:", reasons.join(", "));
  if (left() <= 3_000) throw new ApiError("timeout", "음성을 만드는 데 시간이 너무 오래 걸려요. 화면의 질문을 읽고 답변해 주세요.");
  throw new ApiError("providers_unavailable", quota ? "오늘 쓸 수 있는 음성을 모두 썼어요. 화면의 질문을 읽고 답변해 주세요." : "지금은 질문 음성을 만들 수 없어요. 화면의 질문을 읽고 답변해 주세요.");
}
