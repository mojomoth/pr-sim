import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError, ThinkingLevel } from "@google/genai";
import OpenAI from "openai";
import { z } from "zod";
import { claude, gemini, LITE_FALLBACK, MODELS, openai, quotaAwareFetch } from "@/server/ai";
import { nextStep, type LlmErrorCode } from "./errors";

// Provider-agnostic structured-JSON LLM calls for the wiki.
// WIKI_LLM_PROVIDER = "auto" (default: OpenAI → Claude → Gemini lite models, last resort) | "claude" | "openai" | "gemini".
// A target that fails with quota / usage-limit / auth / connection errors trips a process-wide breaker
// (5 min for quota/auth, 30 s for connection) so later calls skip it instantly instead of retrying.
// Gemini models each have their own free-tier bucket: a per-minute 429 cools that model for its retryDelay only.

type Tier = "extract" | "plan" | "write" | "overview" | "numbers" | "select" | "answer" | "lint";
type Effort = "none" | "low" | "medium";

interface TierSpec {
  openai: { model: string; effort: Effort };
  claude: { model: string; effort: "low" | "medium" };
  maxTokens: number;
}

// Model choice per tier (docs/dev-v1/report.md D4/D5):
//  - bulk reading/writing (extract, write, numbers, lint, plan): Terra, low effort
//  - one-shot synthesis (overview): Sol, runs in parallel with numbers
//  - query path: selection skips reasoning; answers keep low effort for arithmetic
const TIERS: Record<Tier, TierSpec> = {
  extract: { openai: { model: "gpt-6.1-terra", effort: "low" }, claude: { model: MODELS.claudeCheap, effort: "low" }, maxTokens: 12000 },
  plan: { openai: { model: "gpt-6.1-terra", effort: "low" }, claude: { model: MODELS.claudeFast, effort: "low" }, maxTokens: 8000 },
  write: { openai: { model: "gpt-6.1-terra", effort: "low" }, claude: { model: MODELS.claudeFast, effort: "low" }, maxTokens: 12000 },
  numbers: { openai: { model: "gpt-6.1-terra", effort: "low" }, claude: { model: MODELS.claudeFast, effort: "low" }, maxTokens: 16000 },
  overview: { openai: { model: "gpt-6.1-sol", effort: "low" }, claude: { model: MODELS.claudeSmart, effort: "low" }, maxTokens: 12000 },
  lint: { openai: { model: "gpt-6.1-terra", effort: "low" }, claude: { model: MODELS.claudeFast, effort: "low" }, maxTokens: 8000 },
  select: { openai: { model: "gpt-6.1-terra", effort: "none" }, claude: { model: MODELS.claudeCheap, effort: "low" }, maxTokens: 1500 },
  // answer: effort "low" (not "none") — with no reasoning the model got unit arithmetic wrong by 10×
  // (25만 × 12 × 165원 → "49.5억" instead of 4.95억) and then drew a feasibility conclusion from it.
  answer: { openai: { model: "gpt-6.1-terra", effort: "low" }, claude: { model: MODELS.claudeCheap, effort: "low" }, maxTokens: 4000 },
};

export interface CallUsage {
  provider: Provider;
  model: string;
  tier: Tier;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

type Provider = "openai" | "claude" | "gemini";
/** One entry of the chain; breakers are keyed by `key` (provider for OpenAI/Claude, "gemini:<model>" per Gemini model). */
interface Target {
  p: Provider;
  model?: string;
  key: string;
}
const TARGETS: Target[] = [
  { p: "openai", key: "openai" },
  { p: "claude", key: "claude" },
  ...LITE_FALLBACK.map((model): Target => ({ p: "gemini", model, key: `gemini:${model}` })),
];

// ---- circuit breaker (process-wide, survives HMR via globalThis)
// Quota / usage-limit / auth errors are not per-request problems: retrying them only burns time (the reviewer
// measured 23 s for a select call and 46 s for an answer call while both providers were out of credits).
// When a provider fails like that it is "open" for a while and every call skips it instantly.
interface Breaker {
  until: number; // epoch ms
  code: LlmErrorCode;
  label: string; // Korean, short
}
const g = globalThis as unknown as { __wikiBreakers2?: Record<string, Breaker> };
const breakers = (g.__wikiBreakers2 ??= {});
// 5 min: a whole ingest (≈1–2 min) skips the dead provider instead of re-probing it with every parallel call;
// a top-up is still picked up within minutes without a server restart (OpenAI stays first in the chain).
const BREAK_MS: Record<LlmErrorCode, number> = { quota: 300_000, auth: 300_000, network: 30_000, unavailable: 60_000, rate_limit: 15_000, timeout: 0, unknown: 0 };
const PROVIDER_NAME: Record<Provider, string> = { openai: "OpenAI", claude: "Claude", gemini: "Gemini" };

function openBreaker(key: string): Breaker | null {
  const b = breakers[key];
  if (b && b.until > Date.now()) return b;
  if (b) delete breakers[key];
  return null;
}
function trip(t: Target, code: LlmErrorCode, ms = BREAK_MS[code]) {
  if (!ms) return;
  const label =
    code === "quota" ? (t.p === "claude" ? "사용 한도 초과" : t.p === "gemini" ? "일일 한도 초과" : "크레딧 소진") : code === "auth" ? "API 키 거부" : code === "rate_limit" ? "분당 한도 초과" : code === "unavailable" ? "일시 사용 불가" : "연결 실패";
  breakers[t.key] = { until: Date.now() + ms, code, label };
  console.warn(`[wiki/llm] ${t.key} skipped for ${Math.round(ms / 1000)} s (${code})`);
}

/** Thrown when no provider can serve a call right now (quota / auth / connection). Never retried. */
export class LlmUnavailableError extends Error {
  readonly code: LlmErrorCode;
  readonly detail: string; // e.g. "Claude 사용 한도 초과, OpenAI 크레딧 소진"
  constructor(code: LlmErrorCode, detail: string) {
    super(`AI 제공자를 쓸 수 없습니다 (${detail}). ${nextStep(code)}`);
    this.name = "LlmUnavailableError";
    this.code = code;
    this.detail = detail;
  }
}

function wantedProvider(): "auto" | Provider {
  const v = (process.env.WIKI_LLM_PROVIDER ?? "auto").toLowerCase();
  return v === "claude" || v === "openai" || v === "gemini" ? v : "auto";
}
function chain(): Target[] {
  const w = wantedProvider();
  return w === "auto" ? TARGETS : TARGETS.filter((t) => t.p === w);
}

/** Targets to try, in order, skipping open breakers. */
function candidates(): Target[] {
  return chain().filter((t) => !openBreaker(t.key));
}

/** Breaker length for a Gemini model: per-minute limit = its retryDelay, overload 10 s, unknown model 1 h. */
function geminiBreakMs(code: LlmErrorCode, e: unknown): number | undefined {
  if (!(e instanceof GeminiApiError)) return undefined;
  if (code === "rate_limit") return Math.max(5_000, geminiRetryMs(e.message) ?? 15_000);
  if (code === "unavailable") return e.status === 404 ? 3_600_000 : 10_000;
  return undefined;
}

function geminiRetryMs(msg: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(msg) ?? /retry in (\d+(?:\.\d+)?)s/i.exec(msg);
  return m ? Math.round(parseFloat(m[1]) * 1000) : undefined;
}

/** Target-level failure → breaker code (+ how long); null for per-request errors (schema, 400 …). */
function unavailableCode(p: Provider, e: unknown): LlmErrorCode | null {
  if (p === "gemini") {
    if (!(e instanceof GeminiApiError)) return null;
    if (e.status === 429) return /PerDay|per day/i.test(e.message) || (geminiRetryMs(e.message) ?? 0) > 120_000 ? "quota" : "rate_limit";
    if (e.status === 401 || e.status === 403) return "auth";
    if (e.status === 404 || e.status >= 500) return "unavailable";
    return null;
  }
  if (p === "claude") {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "auth";
    if ((e instanceof Anthropic.BadRequestError || e instanceof Anthropic.RateLimitError) && /usage limit|credit balance|billing/i.test(e.message)) return "quota";
    if (e instanceof Anthropic.APIConnectionError && !(e instanceof Anthropic.APIConnectionTimeoutError)) return "network";
    return null;
  }
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) return "auth";
  if (e instanceof OpenAI.RateLimitError && /insufficient_quota|credit|billing/i.test(`${e.code ?? ""} ${e.type ?? ""} ${e.message}`)) return "quota";
  if (e instanceof OpenAI.APIConnectionError && !(e instanceof OpenAI.APIConnectionTimeoutError)) return "network";
  return null;
}

/** Errors that will not get better by retrying the same call. */
function isRetryable(e: unknown): boolean {
  if (e instanceof LlmUnavailableError) return false;
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return false;
  if (e instanceof OpenAI.APIUserAbortError || e instanceof Anthropic.APIUserAbortError) return false;
  if (e instanceof GeminiApiError && [400, 401, 403, 404].includes(e.status)) return false;
  if (e instanceof OpenAI.APIError || e instanceof Anthropic.APIError) {
    const st = e.status ?? 0;
    if (st === 400 || st === 401 || st === 403 || st === 404 || st === 422) return false;
  }
  return true; // schema mismatch, truncated JSON, 5xx, rate limits, timeouts inside the SDK
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

interface JsonCall<T extends z.ZodType> {
  tier: Tier;
  name: string; // schema name (a-z_)
  system: string;
  user: string;
  schema: T;
  onUsage?: (u: CallUsage) => void;
  signal?: AbortSignal;
}

export async function llmJson<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>> {
  for (let wait = 0; ; wait++) {
    call.signal?.throwIfAborted();
    for (const t of candidates()) {
      try {
        return t.p === "claude" ? await claudeJson(call) : t.p === "openai" ? await openaiJson(call) : await geminiJson(call, t.model!);
      } catch (e) {
        const code = unavailableCode(t.p, e);
        if (!code) throw e;
        trip(t, code, geminiBreakMs(code, e)); // → next target in the chain, if any
      }
    }
    // Only short Gemini breakers left (per-minute limit / overload, they clear within seconds): wait for the first
    // one once or twice. Quota / auth / connection breakers are never waited on.
    const soon = chain()
      .map((t) => (t.p === "gemini" ? openBreaker(t.key) : null))
      .filter((b): b is Breaker => b?.code === "rate_limit" || b?.code === "unavailable")
      .reduce((m, b) => Math.min(m, b.until - Date.now()), Infinity);
    if (wait >= 2 || soon > 30_000) break;
    await sleep(soon + 250, call.signal);
  }
  // every candidate failed at the provider level → one Korean error naming each
  throw noProviderError();
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), rej(signal.reason)), { once: true });
  });

function noProviderError(): LlmUnavailableError {
  const seen = new Map<string, Breaker | null>(); // one entry per provider (Gemini models collapse to "Gemini")
  for (const t of chain()) {
    const name = PROVIDER_NAME[t.p];
    const b = openBreaker(t.key);
    if (!seen.get(name)) seen.set(name, b);
  }
  const bs = [...seen];
  return new LlmUnavailableError(bs.find(([, b]) => b)?.[1]?.code ?? "unavailable", bs.map(([n, b]) => `${n} ${b?.label ?? "사용 불가"}`).join(", "));
}

let _oa: OpenAI | undefined;
function oa() {
  // shared server AI client, but with more retries for bursty parallel ingest
  return (_oa ??= openai().withOptions({ maxRetries: 4, timeout: 180_000, fetch: quotaAwareFetch }));
}

async function openaiJson<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>> {
  const spec = TIERS[call.tier];
  const t0 = Date.now();
  const r = await oa().responses.create(
    {
      model: spec.openai.model,
      reasoning: { effort: spec.openai.effort },
      max_output_tokens: spec.maxTokens + (spec.openai.effort === "none" ? 0 : 8000),
      input: [
        { role: "system", content: call.system },
        { role: "user", content: call.user },
      ],
      text: { format: { type: "json_schema", name: call.name, schema: jsonSchemaOf(call.schema), strict: true } },
    },
    { signal: call.signal },
  );
  call.onUsage?.({
    provider: "openai",
    model: spec.openai.model,
    tier: call.tier,
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    ms: Date.now() - t0,
  });
  if (r.status === "incomplete") throw new Error(`openai incomplete: ${r.incomplete_details?.reason ?? "unknown"}`);
  return call.schema.parse(JSON.parse(r.output_text));
}

// Free-tier Gemini allows only a few requests per minute: at most 3 in flight (ingest fans out 8–10 calls).
const G_MAX = 3;
let gActive = 0;
const gQueue: (() => void)[] = [];

async function geminiJson<T extends z.ZodType>(call: JsonCall<T>, model: string): Promise<z.infer<T>> {
  const spec = TIERS[call.tier];
  if (gActive >= G_MAX) await new Promise<void>((r) => gQueue.push(r));
  gActive++;
  try {
    call.signal?.throwIfAborted();
    const t0 = Date.now();
    const r = await gemini().models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: call.user }] }],
      config: {
        systemInstruction: call.system,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchemaOf(call.schema),
        maxOutputTokens: spec.maxTokens + 8000,
        thinkingConfig: { thinkingLevel: spec.openai.effort === "none" ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW },
        abortSignal: call.signal,
        httpOptions: { timeout: 120_000 },
      },
    });
    call.onUsage?.({
      provider: "gemini",
      model,
      tier: call.tier,
      inputTokens: r.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: (r.usageMetadata?.candidatesTokenCount ?? 0) + (r.usageMetadata?.thoughtsTokenCount ?? 0),
      ms: Date.now() - t0,
    });
    const finish = r.candidates?.[0]?.finishReason;
    if (finish && finish !== "STOP") throw new Error(`gemini finish ${finish}`);
    return call.schema.parse(JSON.parse(r.text ?? ""));
  } finally {
    gActive--;
    gQueue.shift()?.();
  }
}

async function claudeJson<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>> {
  const spec = TIERS[call.tier];
  const t0 = Date.now();
  const stream = claude().messages.stream(
    {
      model: spec.claude.model,
      max_tokens: spec.maxTokens + 8000,
      system: call.system,
      thinking: { type: "adaptive" },
      output_config: { effort: spec.claude.effort, format: { type: "json_schema", schema: jsonSchemaOf(call.schema) } },
      messages: [{ role: "user", content: call.user }],
    },
    { signal: call.signal },
  );
  const msg = await stream.finalMessage();
  call.onUsage?.({
    provider: "claude",
    model: spec.claude.model,
    tier: call.tier,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    ms: Date.now() - t0,
  });
  if (msg.stop_reason === "refusal") throw new Error("claude refusal");
  if (msg.stop_reason === "max_tokens") throw new Error("claude max_tokens");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return call.schema.parse(JSON.parse(text));
}

/** Run async jobs with a concurrency cap, preserving order of results. */
export async function pool<I, O>(items: I[], limit: number, fn: (item: I, i: number) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Retry a call on transient failures (schema mismatch / truncated JSON / 5xx). Provider-level failures
 *  (quota, auth, aborted/timeouts, 4xx) are rethrown immediately. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isRetryable(e) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}
