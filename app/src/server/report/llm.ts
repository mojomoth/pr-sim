import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError, ThinkingLevel } from "@google/genai";
import OpenAI from "openai";
import { z } from "zod";
import { claude, gemini, LITE_FALLBACK, MODELS, openai } from "../ai";

// Structured-JSON judgment calls for the report.
//
// Provider chain: OpenAI gpt-6-astra → gpt-6.1-sol → gpt-5.5 → Gemini flash → Claude → Gemini lite (last resort; the
// result screen marks a report made with a "lite" model as lower quality via meta.provider / usage.byModel).
// REPORT_LLM_PROVIDER = auto (default) | claude | openai | gemini restricts the chain.
//
// // Errors are classified so that quota/billing/auth failures are FINAL for that target (no retries, marked down for
// DOWN_TTL so parallel and later calls skip it immediately) while rate limits / 5xx / malformed output are retried.
// SDK-level retries are disabled — this file owns the retry policy. Raw provider messages only go to the server log;
// callers get Korean text (LlmUnavailableError.message / koError()).

const CLAUDE_MODEL = MODELS.claudeSmart; // claude-opus-5-5
const GEMINI_MODELS = (process.env.REPORT_GEMINI_MODELS ?? `gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash`)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export type Provider = "claude" | "openai" | "gemini";
interface Target {
  provider: Provider;
  model: string;
  effort?: "low" | "medium";
}
const PROVIDER_KO: Record<Provider, string> = { claude: "Claude", openai: "OpenAI", gemini: "Gemini" };
const DOWN_TTL_MS = 30 * 60_000;

const tid = (t: Target) => `${t.provider}:${t.model}`;

const isProvider = (v: unknown): v is Provider => v === "claude" || v === "openai" || v === "gemini";

function wanted(): "auto" | Provider {
  const v = (process.env.REPORT_LLM_PROVIDER ?? "auto").toLowerCase();
  return isProvider(v) ? v : "auto";
}

function chain(only?: Provider): Target[] {
  const all: Target[] = [
    { provider: "openai", model: "gpt-6-astra", effort: "medium" },
    { provider: "openai", model: "gpt-6.1-sol", effort: "medium" },
    { provider: "openai", model: "gpt-5.5", effort: "low" },
    ...GEMINI_MODELS.map((model) => ({ provider: "gemini" as const, model })),
    { provider: "claude", model: CLAUDE_MODEL },
    ...LITE_FALLBACK.map((model) => ({ provider: "gemini" as const, model })),
  ];
  const w = only ?? wanted();
  return w === "auto" ? all : all.filter((t) => t.provider === w);
}

// ───────────────────────── down registry (survives HMR) ─────────────────────────

interface Down {
  kind: ErrKind;
  ko: string;
  until: number;
}
const g = globalThis as unknown as { __reportLlmDown?: Map<string, Down> };
const downMap = (g.__reportLlmDown ??= new Map());

function isDown(t: Target): Down | null {
  const d = downMap.get(tid(t));
  if (!d) return null;
  if (Date.now() > d.until) {
    downMap.delete(tid(t));
    return null;
  }
  return d;
}

// ───────────────────────── error classification ─────────────────────────

type ErrKind = "abort" | "quota" | "auth" | "rate" | "transient" | "bad" | "output";
interface Classified {
  kind: ErrKind;
  ko: string;
  retryAfterMs?: number;
}

const QUOTA_RE = /usage limit|credit balance|no credits|insufficient_quota|credit_balance|billing|exceeded your current quota/i;

function geminiRetryDelayMs(msg: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(msg) ?? /retry in (\d+(?:\.\d+)?)s/i.exec(msg);
  return m ? Math.round(parseFloat(m[1]) * 1000) : undefined;
}

function classifyError(e: unknown): Classified {
  if (e instanceof Anthropic.APIUserAbortError || e instanceof OpenAI.APIUserAbortError || (e instanceof Error && e.name === "AbortError")) return { kind: "abort", ko: "요청이 취소됐어요" };
  // Anthropic
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { kind: "auth", ko: "API 키 인증 실패" };
  if (e instanceof Anthropic.BadRequestError) return QUOTA_RE.test(e.message) ? { kind: "quota", ko: "사용 한도 초과" } : { kind: "bad", ko: "요청 형식 오류" };
  if (e instanceof Anthropic.RateLimitError) return QUOTA_RE.test(e.message) ? { kind: "quota", ko: "사용 한도 초과" } : { kind: "rate", ko: "요청이 많아 잠시 제한됨" };
  if (e instanceof Anthropic.APIConnectionError) return { kind: "transient", ko: "연결 실패" };
  if (e instanceof Anthropic.NotFoundError) return { kind: "bad", ko: "모델을 찾을 수 없음" };
  if (e instanceof Anthropic.APIError) return { kind: "transient", ko: "서버 오류" };
  // OpenAI
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) return { kind: "auth", ko: "API 키 인증 실패" };
  if (e instanceof OpenAI.RateLimitError)
    return e.code === "insufficient_quota" || QUOTA_RE.test(e.message) ? { kind: "quota", ko: "크레딧 소진" } : { kind: "rate", ko: "요청이 많아 잠시 제한됨" };
  if (e instanceof OpenAI.BadRequestError) return { kind: "bad", ko: "요청 형식 오류" };
  if (e instanceof OpenAI.NotFoundError) return { kind: "bad", ko: "모델을 찾을 수 없음" };
  if (e instanceof OpenAI.APIConnectionError) return { kind: "transient", ko: "연결 실패" };
  if (e instanceof OpenAI.APIError) return { kind: "transient", ko: "서버 오류" };
  // Gemini
  if (e instanceof GeminiApiError) {
    const delay = geminiRetryDelayMs(e.message);
    if (e.status === 429) {
      const daily = /PerDay|per day/i.test(e.message) || (delay ?? 0) > 120_000;
      return daily ? { kind: "quota", ko: "일일 한도 초과" } : { kind: "rate", ko: "분당 한도 초과", retryAfterMs: delay };
    }
    if (e.status === 401 || e.status === 403) return { kind: "auth", ko: "API 키 인증 실패" };
    if (e.status === 404) return { kind: "bad", ko: "모델을 찾을 수 없음" };
    if (e.status === 400) return { kind: "bad", ko: "요청 형식 오류" };
    return { kind: "transient", ko: "서버 오류" };
  }
  // our own output checks / JSON / zod
  if (e instanceof OutputError || e instanceof SyntaxError || e instanceof z.ZodError) return { kind: "output", ko: "응답 형식 오류" };
  return { kind: "transient", ko: "알 수 없는 오류" };
}

class OutputError extends Error {}

/** Thrown when no provider in the chain could answer. Its message is user-facing Korean. */
export class LlmUnavailableError extends Error {
  constructor(
    message: string,
    readonly failures: { target: string; kind: ErrKind; ko: string }[],
    /** one-line per-provider summary, e.g. "Claude 사용 한도 초과 · OpenAI 크레딧 소진" */
    readonly summary = "",
  ) {
    super(message);
    this.name = "LlmUnavailableError";
  }
  /** true when every failure is quota/auth (retrying now cannot help) */
  get final() {
    return this.failures.length > 0 && this.failures.every((f) => f.kind === "quota" || f.kind === "auth");
  }
}

function summarize(failures: { target: string; provider: Provider; ko: string }[]): string {
  // collapse per provider: "Claude 사용 한도 초과 · OpenAI 크레딧 소진 · Gemini 일일 한도 초과"
  const by = new Map<Provider, Set<string>>();
  for (const f of failures) {
    const s = by.get(f.provider) ?? new Set<string>();
    s.add(f.ko);
    by.set(f.provider, s);
  }
  return [...by.entries()].map(([p, s]) => `${PROVIDER_KO[p]} ${[...s].join("/")}`).join(" · ");
}

/** Korean, user-facing message for any error thrown by a report step (`short` = one line for a progress row). */
export function koError(e: unknown, short = false): string {
  if (e instanceof LlmUnavailableError) return short && e.summary ? `AI 평가 실패 · ${e.summary}` : e.message;
  if (e instanceof Error && /[가-힣]/.test(e.message)) return e.message.slice(0, 200);
  return `처리 중 오류 (${classifyError(e).ko})`;
}

// ───────────────────────── usage ─────────────────────────

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** successful calls per "provider:model" */
  byModel: Record<string, number>;
}
export const newUsage = (): Usage => ({ calls: 0, inputTokens: 0, outputTokens: 0, byModel: {} });

function addUsage(u: Usage | undefined, t: Target, input: number, output: number) {
  if (!u) return;
  u.calls++;
  u.inputTokens += input;
  u.outputTokens += output;
  u.byModel[tid(t)] = (u.byModel[tid(t)] ?? 0) + 1;
}

/** e.g. "gemini:gemini-3.6-flash ×9 (Claude 사용 한도 초과 · OpenAI 크레딧 소진 → 폴백)" — from what this report actually used. */
export function providerLabel(usage?: Usage): string {
  const used = Object.entries(usage?.byModel ?? {}).sort((a, b) => b[1] - a[1]);
  const skipped = chain()
    .filter((t) => !used.some(([k]) => k === tid(t)))
    .map((t) => ({ t, d: isDown(t) }))
    .filter((x) => x.d && x.t.provider !== used[0]?.[0].split(":")[0]);
  const note = skipped.length ? ` (${summarize(skipped.map((x) => ({ target: tid(x.t), provider: x.t.provider, ko: x.d!.ko })))} → 폴백)` : "";
  if (!used.length) return "none";
  return `${used.map(([k, n]) => (used.length > 1 ? `${k} ×${n}` : k)).join(", ")}${note}`;
}

// ───────────────────────── calls ─────────────────────────

export interface JsonCall<T extends z.ZodType> {
  name: string; // a-z_ schema name
  system: string;
  user: string;
  schema: T;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  usage?: Usage;
  signal?: AbortSignal;
  /** restrict this call to one provider (GenerateOptions.provider; default: whole chain) */
  only?: Provider;
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

const MAX_TRIES: Partial<Record<ErrKind, number>> = { rate: 4, transient: 3, output: 2 };
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  });

export async function llmJson<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>> {
  const failures: { target: string; provider: Provider; kind: ErrKind; ko: string }[] = [];
  for (const t of chain(call.only)) {
    const down = isDown(t);
    if (down) {
      failures.push({ target: tid(t), provider: t.provider, kind: down.kind, ko: down.ko });
      continue;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        return await callTarget(t, call);
      } catch (e) {
        const c = classifyError(e);
        if (c.kind === "abort") throw e;
        console.error(`[report/llm] ${tid(t)} ${call.name} attempt ${attempt} → ${c.kind}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
        if (c.kind === "quota" || c.kind === "auth") {
          downMap.set(tid(t), { kind: c.kind, ko: c.ko, until: Date.now() + DOWN_TTL_MS });
          failures.push({ target: tid(t), provider: t.provider, kind: c.kind, ko: c.ko });
          break;
        }
        const max = MAX_TRIES[c.kind] ?? 1;
        if (attempt >= max) {
          failures.push({ target: tid(t), provider: t.provider, kind: c.kind, ko: c.ko });
          break;
        }
        await sleep(Math.min(65_000, c.retryAfterMs ?? 1000 * 2 ** (attempt - 1)), call.signal);
      }
    }
  }
  const allFinal = failures.length > 0 && failures.every((f) => f.kind === "quota" || f.kind === "auth");
  const msg = allFinal
    ? `AI 평가 모델을 지금 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요. (${summarize(failures)})`
    : `AI 평가에 실패했어요. 잠시 뒤 다시 시도해 주세요. (${summarize(failures)})`;
  throw new LlmUnavailableError(msg, failures, summarize(failures));
}

function callTarget<T extends z.ZodType>(t: Target, call: JsonCall<T>): Promise<z.infer<T>> {
  if (t.provider === "claude") return claudeJson(t, call);
  if (t.provider === "openai") return openaiJson(t, call);
  return geminiJson(t, call);
}

let _cl: Anthropic | undefined;
const cl = () => (_cl ??= claude().withOptions({ maxRetries: 0 }));

async function claudeJson<T extends z.ZodType>(t: Target, call: JsonCall<T>): Promise<z.infer<T>> {
  const stream = cl().beta.messages.stream(
    {
      model: t.model,
      max_tokens: call.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: call.effort ?? "high", format: { type: "json_schema", schema: jsonSchemaOf(call.schema) } },
      system: call.system,
      messages: [{ role: "user", content: call.user }],
    },
    { signal: call.signal },
  );
  const msg = await stream.finalMessage();
  addUsage(call.usage, t, msg.usage.input_tokens, msg.usage.output_tokens);
  if (msg.stop_reason === "refusal") throw new OutputError("claude refusal");
  if (msg.stop_reason === "max_tokens") throw new OutputError("claude max_tokens");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return call.schema.parse(JSON.parse(text));
}

let _oa: OpenAI | undefined;
const oa = () => (_oa ??= openai().withOptions({ maxRetries: 0, timeout: 300_000 }));

async function openaiJson<T extends z.ZodType>(t: Target, call: JsonCall<T>): Promise<z.infer<T>> {
  const effort = t.effort;
  const r = await oa().responses.create(
    {
      model: t.model,
      reasoning: { effort },
      max_output_tokens: (call.maxTokens ?? 16000) + 16000,
      input: [
        { role: "system", content: call.system },
        { role: "user", content: call.user },
      ],
      text: { format: { type: "json_schema", name: call.name, schema: jsonSchemaOf(call.schema), strict: true } },
    },
    { signal: call.signal },
  );
  addUsage(call.usage, t, r.usage?.input_tokens ?? 0, r.usage?.output_tokens ?? 0);
  if (r.status === "incomplete") throw new OutputError(`openai incomplete: ${r.incomplete_details?.reason ?? "unknown"}`);
  return call.schema.parse(JSON.parse(r.output_text));
}

async function geminiJson<T extends z.ZodType>(t: Target, call: JsonCall<T>): Promise<z.infer<T>> {
  const r = await gemini().models.generateContent({
    model: t.model,
    contents: [{ role: "user", parts: [{ text: call.user }] }],
    config: {
      systemInstruction: call.system,
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchemaOf(call.schema),
      maxOutputTokens: (call.maxTokens ?? 16000) + 16000,
      thinkingConfig: { thinkingLevel: call.effort === "high" ? ThinkingLevel.HIGH : call.effort === "low" ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM },
      abortSignal: call.signal,
      httpOptions: { timeout: 300_000 },
    },
  });
  addUsage(call.usage, t, r.usageMetadata?.promptTokenCount ?? 0, (r.usageMetadata?.candidatesTokenCount ?? 0) + (r.usageMetadata?.thoughtsTokenCount ?? 0));
  const finish = r.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") throw new OutputError(`gemini finish ${finish}`);
  const text = r.text;
  if (!text) throw new OutputError("gemini empty response");
  return call.schema.parse(JSON.parse(text));
}
