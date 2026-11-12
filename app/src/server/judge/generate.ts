import "server-only";
import OpenAI from "openai";
import { MODELS, openai } from "../ai";
import { ApiError } from "../http";
import type { Temperament } from "../types";
import { buildPrompt, rollTraits, voiceHint, type JudgeTraits } from "./traits";
import type { JudgeOut, RollAvoid } from "./types";

// Judge portrait = gpt-image-2, quality "low" (≈11 s, photoreal at card size), 1024² webp q85 (60–120 KB).
const IMAGE = { size: "1024x1024", quality: "low", format: "webp", compression: 85 } as const;

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

async function generateJudge(temperament: Temperament, traits: JudgeTraits, signal?: AbortSignal): Promise<JudgeOut> {
  let b64: string | undefined;
  try {
    const res = await openai().images.generate(
      {
        model: MODELS.openaiImage,
        prompt: buildPrompt(traits),
        n: 1,
        size: IMAGE.size,
        quality: IMAGE.quality,
        output_format: IMAGE.format,
        output_compression: IMAGE.compression,
        background: "opaque",
        moderation: "auto",
      },
      { timeout: 100_000, maxRetries: 1, signal },
    );
    b64 = res.data?.[0]?.b64_json;
  } catch (e) {
    throw toApi(e);
  }
  if (!b64) throw new Error("OpenAI returned no image data");
  return {
    id: newJudgeId(),
    name: traits.givenName,
    fullName: traits.surname + traits.givenName,
    temperament,
    gender: traits.gender,
    age: traits.age,
    voiceHint: voiceHint(traits, temperament),
    image: { mime: "image/webp", base64: b64 },
  };
}

/**
 * Roll a balanced panel (distinct given names and surnames, mixed genders, spread ages — also against `avoid`,
 * the judges already kept when replacing one) and generate all portraits in parallel. One promise per slot.
 */
export function startPanel(temperaments: Temperament[], avoid: RollAvoid = {}, signal?: AbortSignal): Promise<JudgeOut>[] {
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
