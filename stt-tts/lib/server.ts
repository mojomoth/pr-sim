import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gemini, MODELS } from "@/lib/ai";
import type { Temperament } from "@/lib/types";
import { resolveVoice, ttsPrompt, type VoicePersona } from "./persona";
import { toSentences } from "./sentences";
import { isWav, pcm16ToWav, rateFromMime, wavInfo } from "./wav";

// ---------------------------------------------------------------------------------------------
// Models. MODELS (lib/ai.ts) holds the primary ids; fallbacks are local to this PoC because the
// free-tier quota is tiny (3 requests/min PER MODEL for TTS) and each model has its own bucket.
// ---------------------------------------------------------------------------------------------
export const TTS_MODELS = [MODELS.geminiTts, "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
export const STT_MODELS = [MODELS.geminiTranscribe, MODELS.geminiFlash];
export const LIVE_STT_MODEL = MODELS.geminiTranscribeLive;
/** The SDK (v3) defaults to /v1, where `speechConfig` / `audioTranscriptionConfig` are rejected. */
const V1BETA = { apiVersion: "v1beta", timeout: 45_000 } as const;

const DATA_DIR = path.join(process.cwd(), ".data", "stt-tts");

// ---------------------------------------------------------------------------------------------
// Rate-limit aware model fallback
// ---------------------------------------------------------------------------------------------
const cooldownUntil = new Map<string, number>();

function errStatus(e: unknown): number | undefined {
  const s = (e as { status?: number })?.status;
  if (typeof s === "number") return s;
  const m = String((e as Error)?.message ?? "").match(/"code":\s*(\d{3})/);
  return m ? Number(m[1]) : undefined;
}
function retryDelayMs(e: unknown): number {
  const msg = String((e as Error)?.message ?? "");
  const m = msg.match(/retry in ([\d.]+)s/i) ?? msg.match(/"retryDelay":\s*"(\d+)s"/);
  return m ? Math.ceil(Number(m[1]) * 1000) : 20_000;
}

export class ProviderError extends Error {
  constructor(message: string, public status = 502, public retryAfterSec?: number) {
    super(message);
  }
}

/**
 * Try `models` in order, skipping ones in a 429 cooldown. If every model is cooling down, wait for
 * the earliest one (up to maxWaitMs) and try again once. 5xx / timeouts / unusable output (422)
 * move on to the next model.
 */
interface FallbackOpts {
  /** Max time to wait for a model to leave its 429 cooldown before a second round (default 25s; 0 = fail fast). */
  maxWaitMs?: number;
  /** Absolute time budget (Date.now() ms) for the whole call, all models included. */
  deadline?: number;
}

async function withModelFallback<T>(kind: "tts" | "stt", models: string[], fn: (model: string, timeoutMs: number) => Promise<T>, opts: FallbackOpts = {}): Promise<{ value: T; model: string }> {
  const { maxWaitMs = 25_000, deadline = Infinity } = opts;
  let lastErr: unknown;
  let timedOut = false;
  for (let round = 0; round < 2; round++) {
    for (const model of models) {
      if ((cooldownUntil.get(model) ?? 0) > Date.now()) continue;
      const left = deadline - Date.now();
      if (left < 1_500) { timedOut = true; break; }
      try {
        return { value: await fn(model, Math.min(45_000, left)), model };
      } catch (e) {
        lastErr = e;
        const st = errStatus(e);
        const name = (e as Error)?.name;
        if (st === 429) { cooldownUntil.set(model, Date.now() + retryDelayMs(e)); continue; }
        if (st === 404 || (st === 400 && /not (found|supported)/i.test(String((e as Error).message)))) continue; // model unavailable
        if (st === 422 || (st && st >= 500) || name === "AbortError" || name === "TimeoutError" || /timed? ?out|aborted/i.test(String((e as Error)?.message))) {
          console.warn(`[stt-tts] ${model} failed (${st ?? name}), trying next model`);
          continue;
        }
        throw e;
      }
    }
    if (timedOut) break;
    const next = Math.min(...models.map((m) => cooldownUntil.get(m) ?? 0));
    const wait = next - Date.now();
    if (round === 0 && wait > 0 && wait <= maxWaitMs && Date.now() + wait + 1_500 < deadline) await new Promise((r) => setTimeout(r, wait + 250));
    else if (!(round === 0 && wait <= 0 && lastErr && errStatus(lastErr) !== 429)) break;
  }
  const allCooling = models.every((m) => (cooldownUntil.get(m) ?? 0) > Date.now());
  if (allCooling || errStatus(lastErr) === 429) {
    const next = Math.min(...models.map((m) => cooldownUntil.get(m) ?? 0));
    const sec = Math.max(1, Math.ceil((next - Date.now()) / 1000));
    const msg = sec > 3600
      ? kind === "tts"
        ? "오늘 Gemini TTS 무료 사용량(모델별 일일 요청 수)을 모두 사용했습니다. 이미 생성한 음성은 캐시로 다시 들을 수 있습니다."
        : "오늘 Gemini 전사 무료 사용량(일일 요청 수)을 모두 사용했습니다. 'Live (A)' 모드는 별도 한도라 계속 사용할 수 있습니다."
      : "Gemini 무료 사용량 한도(분당 요청 수)를 초과했습니다. 잠시 후 다시 시도해 주세요.";
    throw new ProviderError(msg, 429, sec);
  }
  if (timedOut || /timed? ?out|aborted/i.test(String((lastErr as Error)?.message ?? (lastErr as Error)?.name ?? ""))) {
    throw new ProviderError(`Gemini ${kind === "stt" ? "전사" : "음성 생성"} 응답 시간 초과 — 잠시 후 다시 시도해 주세요.`, 504);
  }
  throw new ProviderError(`Gemini 호출 실패: ${String((lastErr as Error)?.message ?? lastErr).slice(0, 300)}`, 502);
}

// ---------------------------------------------------------------------------------------------
// STT (architecture B, and reusable batch transcription)
// ---------------------------------------------------------------------------------------------
export interface TranscribeResult {
  text: string;
  sentences: string[];
  model?: string;
  ms?: number;
}

/**
 * Transcribe a finished audio clip (wav/webm/ogg/mp3…) into Korean text + sentences.
 * Uses gemini-3.5-transcribe (generateContent, returns parts[].audioTranscription); falls back to
 * gemini-3.8-flash with a transcription prompt when the transcribe model is rate-limited.
 */
export async function transcribeAudio(buf: Buffer, mime: string, opts: { budgetMs?: number } = {}): Promise<TranscribeResult> {
  if (!buf.byteLength) return { text: "", sentences: [] };
  const t0 = Date.now();
  const data = buf.toString("base64");
  const mimeType = (mime || "audio/wav").split(";")[0];
  // Time budget scales with the clip (25s speech → ~2s). A short live segment fails fast (≤ ~12s)
  // instead of sitting behind the 429-cooldown wait + a 45s timeout.
  const audioSec = wavInfo(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))?.durationSec ?? buf.byteLength / 16_000;
  const budgetMs = opts.budgetMs ?? Math.min(120_000, 10_000 + audioSec * 600);
  const { value: text, model } = await withModelFallback("stt", STT_MODELS, async (model, timeout) => {
    const transcribeModel = model.includes("transcribe");
    const res = await gemini().models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: transcribeModel
          ? [{ inlineData: { mimeType, data } }]
          : [{ inlineData: { mimeType, data } }, { text: "이 음성을 한국어로 그대로 받아 적어 주세요. 문장부호(. ? !)를 넣고, 전사 텍스트만 출력하세요. 음성이 없으면 빈 문자열만 출력하세요." }],
      }],
      config: transcribeModel
        ? { httpOptions: { ...V1BETA, timeout }, audioTranscriptionConfig: { languageCodes: ["ko-KR"] } }
        : { httpOptions: { ...V1BETA, timeout }, temperature: 0 },
    });
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.audioTranscription?.text ?? p.text ?? "").join(" ").trim();
  }, { maxWaitMs: 0, deadline: t0 + budgetMs });
  return { text, sentences: toSentences(text), model, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------------------------
// Live STT (architecture A): ephemeral token so the browser can talk to the Live API directly
// ---------------------------------------------------------------------------------------------
/** Config locked into the token; the client must connect with the same model. */
export const LIVE_CONFIG = { inputAudioTranscription: { languageCodes: ["ko-KR"] } };

export async function mintLiveToken(): Promise<{ token: string; model: string; expiresAt: string; config: typeof LIVE_CONFIG }> {
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const tok = await gemini().authTokens.create({
    config: {
      httpOptions: { apiVersion: "v1alpha" },
      uses: 1, // one Live session per token; the client mints a new one on reconnect
      expireTime: expiresAt,
      newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
      liveConnectConstraints: { model: LIVE_STT_MODEL, config: LIVE_CONFIG },
    },
  });
  if (!tok.name) throw new ProviderError("에페메랄 토큰 발급 실패", 502);
  return { token: tok.name, model: LIVE_STT_MODEL, expiresAt, config: LIVE_CONFIG };
}

// ---------------------------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------------------------
export interface SpeechResult {
  wav: Buffer;
  voice: string;
  style: string;
  model?: string;
  cached?: boolean;
  durationSec?: number;
  ms?: number;
}

const inflight = new Map<string, Promise<SpeechResult>>();

/**
 * Korean read speech is ~0.12–0.2 s per character. Anything far longer means the model spoke more
 * than the line (seen: gemini-3.8-flash-lite-tts reading the director's notes), far shorter = cut off.
 */
export function plausibleDuration(text: string, sec: number): boolean {
  const chars = text.replace(/\s/g, "").length;
  return sec >= Math.min(0.6, chars * 0.04) && sec <= 3 + chars * 0.3;
}

/**
 * Synthesize `text` with the voice/style resolved from the persona. Result is cached on disk by
 * hash(voice, style, text), so replays and repeated judge lines cost no quota.
 */
export async function synthesizeSpeech(text: string, p: { gender: "male" | "female"; age: number; temperament: Temperament }): Promise<SpeechResult> {
  const persona: VoicePersona = { gender: p.gender, age: Math.round(Math.min(70, Math.max(20, p.age))), temperament: p.temperament };
  const { voice, style } = resolveVoice(persona);
  const line = text.trim().slice(0, 1200);
  if (!line) throw new ProviderError("읽을 문장이 비어 있습니다.", 400);
  const key = createHash("sha256").update(JSON.stringify([voice, style, line])).digest("hex").slice(0, 24);
  const file = path.join(DATA_DIR, "tts", `${key}.wav`);
  const metaFile = path.join(DATA_DIR, "tts", `${key}.json`);

  try {
    const [wav, meta] = await Promise.all([readFile(file), readFile(metaFile, "utf8")]);
    const m = JSON.parse(meta) as { model?: string; durationSec?: number };
    if (plausibleDuration(line, m.durationSec ?? 0)) return { wav, voice, style, model: m.model, durationSec: m.durationSec, cached: true, ms: 0 };
  } catch {
    /* cache miss */
  }

  const existing = inflight.get(key);
  if (existing) return existing;
  const job = (async () => {
    const t0 = Date.now();
    const { value: audio, model } = await withModelFallback("tts", TTS_MODELS, async (model, timeout) => {
      const res = await gemini().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: ttsPrompt(line, style) }] }],
        config: {
          httpOptions: { ...V1BETA, timeout },
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });
      const part = res.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
      if (!part?.inlineData?.data) throw new ProviderError(`TTS 응답에 오디오가 없습니다 (${res.candidates?.[0]?.finishReason ?? "unknown"})`, 502);
      const raw = new Uint8Array(Buffer.from(part.inlineData.data, "base64"));
      // Older models return raw PCM s16le 24kHz (audio/L16;rate=24000); 3.8 models already send WAV.
      const wavBytes = isWav(raw) ? raw : pcm16ToWav(raw, rateFromMime(part.inlineData.mimeType, 24000));
      const durationSec = Math.round((wavInfo(wavBytes)?.durationSec ?? 0) * 100) / 100;
      if (!plausibleDuration(line, durationSec)) {
        // e.g. the model read the style directions aloud → discard and try the next model
        throw new ProviderError(`TTS 길이 이상 (${durationSec}s, ${model})`, 422);
      }
      return { wavBytes, durationSec, mime: part.inlineData.mimeType };
    });
    const wav = Buffer.from(audio.wavBytes);
    const durationSec = audio.durationSec;
    await mkdir(path.dirname(file), { recursive: true });
    await Promise.all([
      writeFile(file, wav),
      writeFile(metaFile, JSON.stringify({ voice, style, text: line, model, mime: audio.mime, durationSec, createdAt: new Date().toISOString() })),
    ]);
    return { wav, voice, style, model, durationSec, cached: false, ms: Date.now() - t0 };
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}
