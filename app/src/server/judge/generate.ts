import "server-only";
import { ApiError as GeminiApiError } from "@google/genai";
import OpenAI from "openai";
import { gemini, MODELS, openai, quotaAwareFetch } from "../ai";
import { ApiError } from "../http";
import type { Temperament } from "../types";
import { buildPrompt, rollTraits, voiceHint, type JudgeTraits } from "./traits";
import type { JudgeOut, RollAvoid } from "./types";

// Judge portrait = gpt-image-2, quality "low" (≈11 s, photoreal at card size), 1024² webp q85 (60–120 KB).
// When OpenAI is out of credits / its key is refused, ONE Gemini image call per model (same prompt) is tried,
// then the slot fails with OpenAI's error code and the client shows initials. Quota errors are never retried:
// a target that answered with quota / auth is skipped for QUOTA_SKIP_MS by every later judge.
const IMAGE = { size: "1024x1024", quality: "low", format: "webp", compression: 85 } as const;
const GEMINI_IMAGE = ["gemini-3.1-flash-image", "gemini-3-pro-image"] as const;
const QUOTA_SKIP_MS = 10 * 60_000;
const skipUntil = ((globalThis as unknown as { __judgeSkip?: Map<string, number> }).__judgeSkip ??= new Map());
const skipped = (k: string) => (skipUntil.get(k) ?? 0) > Date.now();

function newJudgeId() {
  const rand = crypto.getRandomValues(new Uint8Array(5));
  return `j_${Date.now().toString(36)}${Array.from(rand, (b) => (b % 36).toString(36)).join("")}`;
}

function toApi(e: unknown): unknown {
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new ApiError("timeout");
  if (e instanceof OpenAI.APIError) {
    const detail = `${e.code ?? ""} ${e.type ?? ""} ${e.message}`;
    if (/moderation|content_policy|safety/i.test(detail)) return new ApiError("unsupported", "이미지 생성이 정책상 거절됐어요. 다시 시도해 주세요.");
    if (e.status === 429 && /insufficient_quota|billing/i.test(detail)) return new ApiError("providers_unavailable");
    if (e.status === 429) return new ApiError("rate_limited", undefined, 30);
    if (e.status === 401 || e.status === 403) return new ApiError("providers_unavailable");
  }
  return e; // → upstream (logged) via toApiError
}

type Image = JudgeOut["image"] & { model: string };
let _oa: OpenAI | undefined; // no SDK retry on "no credits" 429s

async function openaiImage(prompt: string, signal?: AbortSignal): Promise<Image> {
  const res = await (_oa ??= openai().withOptions({ fetch: quotaAwareFetch })).images.generate(
    { model: MODELS.openaiImage, prompt, n: 1, size: IMAGE.size, quality: IMAGE.quality, output_format: IMAGE.format, output_compression: IMAGE.compression, background: "opaque", moderation: "auto" },
    { timeout: 100_000, maxRetries: 1, signal },
  );
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return { mime: "image/webp", base64: b64, model: MODELS.openaiImage };
}

/** One call per Gemini image model, no retries. null when none produced an image. */
async function geminiImage(prompt: string, signal?: AbortSignal): Promise<Image | null> {
  for (const model of GEMINI_IMAGE) {
    if (skipped(model)) continue;
    try {
      const r = await gemini().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" }, abortSignal: signal, httpOptions: { timeout: 60_000 } },
      });
      const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (part?.inlineData?.data) return { mime: part.inlineData.mimeType ?? "image/png", base64: part.inlineData.data, model };
      console.warn(`[judges] ${model}: no image (${r.candidates?.[0]?.finishReason ?? "unknown"})`);
    } catch (e) {
      if (signal?.aborted) throw e;
      const st = e instanceof GeminiApiError ? e.status : undefined;
      if (st === 429 || st === 401 || st === 403 || st === 404) skipUntil.set(model, Date.now() + QUOTA_SKIP_MS);
      console.warn(`[judges] ${model} failed (${st ?? (e as Error).message?.slice(0, 80)})`);
    }
  }
  return null;
}

async function generateJudge(temperament: Temperament, traits: JudgeTraits, signal?: AbortSignal): Promise<{ judge: JudgeOut; model: string }> {
  const prompt = buildPrompt(traits);
  let image: Image | null = null;
  let openaiErr: unknown = new ApiError("providers_unavailable");
  if (!skipped("openai")) {
    try {
      image = await openaiImage(prompt, signal);
    } catch (e) {
      openaiErr = toApi(e);
      if (!(openaiErr instanceof ApiError && openaiErr.code === "providers_unavailable")) throw openaiErr; // policy / rate / timeout: no fallback
      skipUntil.set("openai", Date.now() + QUOTA_SKIP_MS);
    }
  }
  image ??= await geminiImage(prompt, signal);
  if (!image) throw openaiErr;
  const { model, ...img } = image;
  return {
    model,
    judge: {
      id: newJudgeId(),
      name: traits.givenName,
      fullName: traits.surname + traits.givenName,
      temperament,
      gender: traits.gender,
      age: traits.age,
      voiceHint: voiceHint(traits, temperament),
      image: img,
    },
  };
}

/**
 * Roll a balanced panel (distinct given names and surnames, mixed genders, spread ages — also against `avoid`,
 * the judges already kept when replacing one) and generate all portraits in parallel. One promise per slot.
 */
export function startPanel(temperaments: Temperament[], avoid: RollAvoid = {}, signal?: AbortSignal): Promise<{ judge: JudgeOut; model: string }>[] {
  const taken: Required<RollAvoid> = { names: [...(avoid.names ?? [])], surnames: [...(avoid.surnames ?? [])], genders: [...(avoid.genders ?? [])], ages: [...(avoid.ages ?? [])] };
  const rolled = temperaments.map((t) => {
    const tr = rollTraits(t, taken);
    taken.names.push(tr.givenName);
    taken.surnames.push(tr.surname);
    taken.genders.push(tr.gender);
    taken.ages.push(tr.age);
    return tr;
  });
  return temperaments.map((t, i) => generateJudge(t, rolled[i], signal));
}
