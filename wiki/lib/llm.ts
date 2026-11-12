import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { claude, MODELS, openai } from "@/lib/ai";
import { nextStep, type LlmErrorCode } from "./errors";

// Provider-agnostic structured-JSON LLM calls for the wiki.
// WIKI_LLM_PROVIDER = "auto" (default: Claude first, OpenAI when Claude's breaker is open) | "claude" | "openai".
// A provider that fails with quota / usage-limit / auth / connection errors trips a process-wide breaker
// (60 s for quota/auth, 30 s for connection) so later calls skip it instantly instead of retrying.

export type Tier = "extract" | "plan" | "write" | "overview" | "numbers" | "select" | "answer" | "lint";
type Effort = "none" | "low" | "medium";

interface TierSpec {
  openai: { model: string; effort: Effort };
  claude: { model: string; effort: "low" | "medium" };
  maxTokens: number;
}

// Model choice per tier (see README "모델 선택"):
//  - bulk reading/writing (extract, write, numbers, lint, plan): fast mid model, low effort
//  - one-shot synthesis (overview): strongest model, runs in parallel with numbers so wall time ≈ its latency
//  - query path (select, answer): smallest/fastest models — this is the hot path for judges/report
export const TIERS: Record<Tier, TierSpec> = {
  extract: { openai: { model: "gpt-5.4-mini", effort: "low" }, claude: { model: MODELS.claudeCheap, effort: "low" }, maxTokens: 12000 },
  plan: { openai: { model: "gpt-5.4-mini", effort: "low" }, claude: { model: MODELS.claudeFast, effort: "low" }, maxTokens: 8000 },
  write: { openai: { model: "gpt-5.4-mini", effort: "low" }, claude: { model: MODELS.claudeFast, effort: "low" }, maxTokens: 12000 },
  numbers: { openai: { model: "gpt-5.4-mini", effort: "low" }, claude: { model: MODELS.claudeFast, effort: "low" }, maxTokens: 16000 },
  overview: { openai: { model: "gpt-5.5", effort: "low" }, claude: { model: MODELS.claudeSmart, effort: "low" }, maxTokens: 12000 },
  lint: { openai: { model: "gpt-5.4-mini", effort: "low" }, claude: { model: MODELS.claudeFast, effort: "low" }, maxTokens: 8000 },
  select: { openai: { model: "gpt-5.4-nano", effort: "none" }, claude: { model: MODELS.claudeCheap, effort: "low" }, maxTokens: 1500 },
  // answer: effort "low" (not "none") — with no reasoning the model got unit arithmetic wrong by 10×
  // (25만 × 12 × 165원 → "49.5억" instead of 4.95억) and then drew a feasibility conclusion from it.
  answer: { openai: { model: "gpt-5.4-mini", effort: "low" }, claude: { model: MODELS.claudeCheap, effort: "low" }, maxTokens: 4000 },
};

export interface CallUsage {
  provider: "openai" | "claude";
  model: string;
  tier: Tier;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

type Provider = "openai" | "claude";

// ---- circuit breaker (process-wide, survives HMR via globalThis)
// Quota / usage-limit / auth errors are not per-request problems: retrying them only burns time (the reviewer
// measured 23 s for a select call and 46 s for an answer call while both providers were out of credits).
// When a provider fails like that it is "open" for a while and every call skips it instantly.
interface Breaker {
  until: number; // epoch ms
  code: LlmErrorCode;
  label: string; // Korean, short
}
const g = globalThis as unknown as { __wikiBreakers?: Partial<Record<Provider, Breaker>> };
const breakers = (g.__wikiBreakers ??= {});
// 60 s: long enough that a burst of calls (parallel ingest chunks, a query's select+answer) all skip the dead
// provider, short enough that topping up credits is picked up within a minute without a server restart.
const BREAK_MS: Record<LlmErrorCode, number> = { quota: 60_000, auth: 60_000, network: 30_000, unavailable: 60_000, rate_limit: 0, timeout: 0, unknown: 0 };
const PROVIDER_NAME: Record<Provider, string> = { openai: "OpenAI", claude: "Claude" };

function openBreaker(p: Provider): Breaker | null {
  const b = breakers[p];
  if (b && b.until > Date.now()) return b;
  if (b) delete breakers[p];
  return null;
}
function trip(p: Provider, code: LlmErrorCode) {
  const ms = BREAK_MS[code];
  if (!ms) return;
  const label = code === "quota" ? (p === "claude" ? "사용 한도 초과" : "크레딧 소진") : code === "auth" ? "API 키 거부" : "연결 실패";
  breakers[p] = { until: Date.now() + ms, code, label };
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
  return v === "claude" || v === "openai" ? v : "auto";
}

/** Providers to try, in order, skipping open breakers. */
function candidates(): Provider[] {
  const w = wantedProvider();
  const order: Provider[] = w === "auto" ? ["claude", "openai"] : [w];
  return order.filter((p) => !openBreaker(p));
}

export function activeProvider(): Provider {
  return candidates()[0] ?? (wantedProvider() === "claude" ? "claude" : "openai");
}

export function providerNote(): string {
  const w = wantedProvider();
  const off = (["claude", "openai"] as Provider[]).map((p) => [p, openBreaker(p)] as const).filter(([, b]) => b);
  const offTxt = off.map(([p, b]) => `${p} 비활성: ${b!.label}`).join(", ");
  if (!candidates().length) return `${w} (사용 가능한 제공자 없음${offTxt ? ` — ${offTxt}` : ""})`;
  return w === "auto" ? `auto→${activeProvider()}${offTxt ? ` (${offTxt})` : ""}` : w;
}

/** Provider-level failure (quota / auth / connection) → breaker code; null for per-request errors. */
function unavailableCode(p: Provider, e: unknown): LlmErrorCode | null {
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
export function isRetryable(e: unknown): boolean {
  if (e instanceof LlmUnavailableError) return false;
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return false;
  if (e instanceof OpenAI.APIUserAbortError || e instanceof Anthropic.APIUserAbortError) return false;
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

export interface JsonCall<T extends z.ZodType> {
  tier: Tier;
  name: string; // schema name (a-z_)
  system: string;
  user: string;
  schema: T;
  onUsage?: (u: CallUsage) => void;
  signal?: AbortSignal;
}

export async function llmJson<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>> {
  const order = candidates();
  if (!order.length) throw noProviderError();
  for (const p of order) {
    try {
      return p === "claude" ? await claudeJson(call) : await openaiJson(call);
    } catch (e) {
      const code = unavailableCode(p, e);
      if (!code) throw e;
      trip(p, code); // → next provider in the auto chain, if any
    }
  }
  // every candidate failed at the provider level → one Korean error naming each
  throw noProviderError();
}

function noProviderError(): LlmUnavailableError {
  const w = wantedProvider();
  const ps: Provider[] = w === "auto" ? ["claude", "openai"] : [w];
  const bs = ps.map((p) => [p, openBreaker(p)] as const);
  return new LlmUnavailableError(bs.find(([, b]) => b)?.[1]?.code ?? "unavailable", bs.map(([p, b]) => `${PROVIDER_NAME[p]} ${b?.label ?? "사용 불가"}`).join(", "));
}

/** True when no provider can currently be called (all breakers open). Lets callers skip LLM steps up front. */
export function llmAvailable(): boolean {
  return candidates().length > 0;
}

/** OpenAI's SDK retries every 429 (up to maxRetries with backoff) — including "insufficient_quota", which never
 *  recovers. Mark those responses as non-retryable so the call fails in ~1 s instead of ~20 s. */
const quotaAwareFetch: typeof fetch = async (input, init) => {
  const r = await fetch(input, init);
  if (r.status !== 429) return r;
  const text = await r.clone().text();
  if (!/insufficient_quota|credit_balance|no credits|billing/i.test(text)) return r;
  const headers = new Headers(r.headers);
  headers.set("x-should-retry", "false");
  return new Response(text, { status: r.status, statusText: r.statusText, headers });
};

let _oa: OpenAI | undefined;
function oa() {
  // shared client from lib/ai.ts, but with more retries for bursty parallel ingest
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
