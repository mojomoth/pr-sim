import "server-only";
import OpenAI from "openai";
import { MODELS, openai } from "@/lib/ai";
import type { JudgePersona, Temperament } from "@/lib/types";
import { JudgeGenError, type JudgeErrorKind } from "./errors";
import type { ImageQuality, JudgeRecord } from "./model";
import { newJudgeId, readAllJudges, readJudge, removeJudge, saveJudge } from "./store";
import { buildPrompt, rollTraits, voiceHint, type JudgeTraits, type RollAvoid } from "./traits";

export type { JudgeRecord, ImageQuality } from "./model";
export type { JudgeTraits, RollAvoid } from "./traits";
export { JudgeGenError } from "./errors";
export { rollTraits, buildPrompt, voiceHint } from "./traits";

export const TEMPERAMENTS: readonly Temperament[] = ["friendly", "strict", "aggressive"];
export const isTemperament = (v: unknown): v is Temperament => typeof v === "string" && (TEMPERAMENTS as readonly string[]).includes(v);

/** Image settings. 1024² webp q85 ≈ 60–80KB; "low" quality is ~11s and already photoreal at card sizes. */
export const IMAGE_DEFAULTS = { size: "1024x1024", quality: "low" as ImageQuality, format: "webp" as const, compression: 85, thumbPx: 256 };

export interface GenerateOptions {
  quality?: ImageQuality;
  /** Avoid duplicate names / balance genders & ages (used by generatePanel). */
  avoid?: RollAvoid;
  /** Pre-rolled traits (e.g. from generatePanel). If omitted, rolled randomly. */
  traits?: JudgeTraits;
  /** Dev-only: force an error kind to exercise UI error states without spending API calls. */
  simulateError?: JudgeErrorKind;
  signal?: AbortSignal;
}

function classify(e: unknown): JudgeGenError {
  if (e instanceof JudgeGenError) return e;
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new JudgeGenError("timeout", e.message);
  if (e instanceof OpenAI.APIError) {
    const code = (e.code ?? "") + " " + (e.type ?? "") + " " + e.message;
    const s = e.status;
    if (/moderation|content_policy|safety/i.test(code)) return new JudgeGenError("moderation", e.message, s);
    if (s === 429) return new JudgeGenError("rate_limit", e.message, s);
    if (s === 401 || s === 403) return new JudgeGenError("auth", e.message, s);
    if (s === 400 || s === 422) return new JudgeGenError("bad_request", e.message, s);
    if (s && s >= 500) return new JudgeGenError("server", e.message, s);
  }
  return new JudgeGenError("unknown", e instanceof Error ? e.message : String(e));
}

async function makeThumb(img: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(img).resize(IMAGE_DEFAULTS.thumbPx, IMAGE_DEFAULTS.thumbPx, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  } catch (e) {
    console.warn("[judge] thumbnail failed; serving full image instead", e);
    return null;
  }
}

/** Shape-only view for cross-PoC consumers (question / stt-tts / real app). */
export function toPersona(r: JudgeRecord): JudgePersona & { fullName: string; voiceHint: string } {
  return { id: r.id, name: r.name, temperament: r.temperament, gender: r.gender, age: r.age, imageUrl: r.imageUrl, fullName: r.fullName, voiceHint: r.voiceHint };
}

/**
 * Generate one judge: roll random traits for the temperament, call gpt-image-2,
 * persist image + 256px thumb + metadata under .data/judge/.
 */
export async function generateJudge(temperament: Temperament, opts: GenerateOptions = {}): Promise<JudgeRecord> {
  if (!isTemperament(temperament)) throw new JudgeGenError("bad_request", `invalid temperament: ${String(temperament)}`);
  const quality = opts.quality ?? IMAGE_DEFAULTS.quality;
  const traits = opts.traits ?? rollTraits(temperament, opts.avoid);
  const prompt = buildPrompt(traits);
  const t0 = Date.now();

  if (opts.simulateError) {
    await new Promise((r) => setTimeout(r, 1200));
    throw new JudgeGenError(opts.simulateError, `simulated ${opts.simulateError}`);
  }

  let b64: string | undefined;
  let size: string = IMAGE_DEFAULTS.size;
  try {
    const res = await openai().images.generate(
      {
        model: MODELS.openaiImage,
        prompt,
        n: 1,
        size: IMAGE_DEFAULTS.size,
        quality,
        output_format: IMAGE_DEFAULTS.format,
        output_compression: IMAGE_DEFAULTS.compression,
        background: "opaque",
        moderation: "auto",
      },
      { timeout: 180_000, maxRetries: 1, signal: opts.signal },
    );
    b64 = res.data?.[0]?.b64_json;
    size = res.size ?? size;
  } catch (e) {
    throw classify(e);
  }
  if (!b64) throw new JudgeGenError("server", "OpenAI returned no image data");
  const ms = Date.now() - t0;

  const image = Buffer.from(b64, "base64");
  const thumb = await makeThumb(image);
  const id = newJudgeId();
  const rec: JudgeRecord = {
    id,
    name: traits.givenName,
    fullName: traits.surname + traits.givenName,
    surname: traits.surname,
    temperament,
    gender: traits.gender,
    age: traits.age,
    imageUrl: `/api/judge/image/${id}`,
    thumbUrl: `/api/judge/image/${id}?size=thumb`,
    voiceHint: voiceHint(traits, temperament),
    traits,
    prompt,
    ms,
    totalMs: 0,
    model: MODELS.openaiImage,
    quality,
    size,
    bytes: image.length,
    createdAt: new Date().toISOString(),
  };
  rec.totalMs = Date.now() - t0;
  await saveJudge(rec, image, thumb);
  return rec;
}

/**
 * Roll a balanced panel (distinct given names AND surnames, mixed genders, spread ages) and generate all
 * portraits in parallel. Returns one promise per temperament so callers can stream results.
 */
export function startPanel(temperaments: Temperament[], opts: Omit<GenerateOptions, "avoid" | "traits"> = {}): Promise<JudgeRecord>[] {
  const avoid: Required<RollAvoid> = { names: [], surnames: [], genders: [], ages: [] };
  const rolled = temperaments.map((t) => {
    const tr = rollTraits(t, avoid);
    avoid.names.push(tr.givenName);
    avoid.surnames.push(tr.surname);
    avoid.genders.push(tr.gender);
    avoid.ages.push(tr.age);
    return tr;
  });
  return temperaments.map((t, i) => generateJudge(t, { ...opts, traits: rolled[i] }));
}

export async function generatePanel(temperaments: Temperament[], opts: Omit<GenerateOptions, "avoid" | "traits"> = {}) {
  return Promise.allSettled(startPanel(temperaments, opts));
}

export const listJudges = (): Promise<JudgeRecord[]> => readAllJudges();
export const getJudge = (id: string): Promise<JudgeRecord | null> => readJudge(id);
export const deleteJudge = (id: string): Promise<boolean> => removeJudge(id);
