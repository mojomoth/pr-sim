import "server-only";
import { ThinkingLevel } from "@google/genai";
import OpenAI from "openai";
import { z } from "zod";
import { claude, gemini, MODELS, openai } from "../ai";
import { classify, downReason, isAbort, markDown, ProvidersUnavailableError, type ProviderName } from "./providers";
import type { LlmUsage } from "./types";

// Ordered per-role targets: OpenAI first, Gemini rotation, Claude last resort.
type Role = "generate" | "followup";
type Provider = ProviderName;
type OpenAITarget = { provider: "openai"; model: string; effort: "none" | "low" };
type Target = OpenAITarget | { provider: "gemini"; model: string } | { provider: "claude"; model: string; effort: "low" };
const GEMINI_CHAIN = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"];
const ROLE_TARGETS: Record<Role, Target[]> = {
  generate: [
    { provider: "openai", model: "gpt-6.1-terra", effort: "low" },
    { provider: "openai", model: "gpt-5.5", effort: "none" },
    ...GEMINI_CHAIN.map((model): Target => ({ provider: "gemini", model })),
    { provider: "claude", model: MODELS.claudeFast, effort: "low" },
  ],
  followup: [
    { provider: "openai", model: "gpt-5.5", effort: "low" },
    { provider: "openai", model: "gpt-6.1-terra", effort: "low" },
    ...GEMINI_CHAIN.map((model): Target => ({ provider: "gemini", model })),
    { provider: "claude", model: MODELS.claudeFast, effort: "low" },
  ],
};
const MAX_TOKENS = { generate: 6000, followup: 3000 };
function available(target: Target): boolean {
  return !downReason(target.provider) && (target.provider !== "gemini" || (gCool.get(target.model) ?? 0) <= Date.now());
}
export function providerLabel(role: Role = "generate"): string {
  const target = ROLE_TARGETS[role].find(available);
  return target ? `${target.provider}:${target.model}` : "unavailable";
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

interface StreamJsonCall<T extends z.ZodType> {
  role: Role;
  name: string;
  shared: string; // identical across judges of a run (cached prefix)
  persona: string; // judge-specific system text
  user: string;
  schema: T;
  /** Called with the accumulated raw JSON text as it streams. */
  onText?: (acc: string) => void;
  signal?: AbortSignal;
}

/** Try each provider of the chain in order; throws ProvidersUnavailableError when all fail. */
export async function streamJson<T extends z.ZodType>(call: StreamJsonCall<T>): Promise<{ data: z.infer<T>; usage: LlmUsage }> {
  const reasons: Partial<Record<Provider, string>> = {};
  call.signal?.throwIfAborted();
  for (const target of ROLE_TARGETS[call.role]) {
    const p = target.provider;
    const off = downReason(p);
    if (off) {
      reasons[p] = off;
      continue;
    }
    if (!available(target)) continue;
    try {
      if (target.provider === "claude") return await claudeStream(call, target);
      if (target.provider === "openai") return await openaiStream(call, target);
      return await geminiStream(call, target.model);
    } catch (e) {
      if (call.signal?.aborted || (p !== "gemini" && isAbort(e))) throw e;
      const c = classify(p, e);
      reasons[p] = c.short;
      if (c.kind === "billing") markDown(p, c.short, c.untilMs);
      console.warn(`[question] ${p} failed (${c.kind}: ${c.short}) → next provider`);
    }
  }
  const err = new ProvidersUnavailableError(reasons);
  err.retryable = ROLE_TARGETS[call.role].some(available); // something only transiently failed
  throw err;
}

// ---------------------------------------------------------------------------------------------
// Gemini (free tier; each model has its own quota bucket → rotate on 429/503)
// ---------------------------------------------------------------------------------------------
const gCool = ((globalThis as unknown as { __questionGeminiCool?: Map<string, number> }).__questionGeminiCool ??= new Map());
function retryDelayMs(e: unknown): number {
  const msg = String((e as Error)?.message ?? "");
  const m = msg.match(/retry in ([\d.]+)s/i) ?? msg.match(/"retryDelay":\s*"(\d+)s"/);
  return Math.max(30_000, m ? Math.ceil(Number(m[1]) * 1000) : 60_000);
}

async function geminiStream<T extends z.ZodType>(call: StreamJsonCall<T>, targetModel: string): Promise<{ data: z.infer<T>; usage: LlmUsage }> {
  const models = [targetModel];
  if (!models.length) throw Object.assign(new Error("all gemini models cooling down"), { status: 429 });
  const schema = jsonSchemaOf(call.schema);
  let last: unknown;
  for (const model of models) {
    const t0 = Date.now();
    let ttft: number | undefined;
    let acc = "";
    // own controller: caller abort + first-token deadline (15 s) + total deadline (60 s) → next model
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    call.signal?.addEventListener("abort", onAbort);
    let timedOut = "";
    const firstTimer = setTimeout(() => ((timedOut = "first-token 15s"), ac.abort()), 15_000);
    const totalTimer = setTimeout(() => ((timedOut = "total 60s"), ac.abort()), 60_000);
    try {
      const stream = await gemini().models.generateContentStream({
        model,
        contents: [{ role: "user", parts: [{ text: call.user }] }],
        config: {
          httpOptions: { apiVersion: "v1beta" },
          abortSignal: ac.signal,
          systemInstruction: `${call.shared}\n\n${call.persona}`,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          maxOutputTokens: MAX_TOKENS[call.role] + 6000,
        },
      });
      let um: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number } | undefined;
      for await (const chunk of stream) {
        const t = chunk.text;
        if (t) {
          if (ttft == null) clearTimeout(firstTimer);
          ttft ??= Date.now() - t0;
          acc += t;
          call.onText?.(acc);
        }
        if (chunk.usageMetadata) um = chunk.usageMetadata;
      }
      const data = call.schema.parse(JSON.parse(acc));
      return {
        data,
        usage: { provider: "gemini", model, inputTokens: um?.promptTokenCount ?? 0, cachedInputTokens: um?.cachedContentTokenCount ?? 0, outputTokens: um?.candidatesTokenCount ?? 0, ms: Date.now() - t0, ttftMs: ttft },
      };
    } catch (e) {
      if (call.signal?.aborted) throw e; // the caller gave up — not a model problem
      last = timedOut ? new Error(`gemini ${model} timeout (${timedOut})`) : e;
      const st = (e as { status?: number }).status;
      if (st === 429) gCool.set(model, Date.now() + retryDelayMs(e));
      else if (st === 404) gCool.set(model, Date.now() + 24 * 3600_000);
      else if (st === 503) gCool.set(model, Date.now() + 30_000);
      else if (timedOut) gCool.set(model, Date.now() + 60_000);
      console.warn(`[question] gemini ${model} failed (${timedOut || st || (e as Error).message?.slice(0, 60)}) → next model`);
    } finally {
      clearTimeout(firstTimer);
      clearTimeout(totalTimer);
      call.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw last;
}

let _oa: OpenAI | undefined;
const oa = () => (_oa ??= openai().withOptions({ maxRetries: 3, timeout: 120_000 }));

async function openaiStream<T extends z.ZodType>(call: StreamJsonCall<T>, spec: OpenAITarget): Promise<{ data: z.infer<T>; usage: LlmUsage }> {
  const t0 = Date.now();
  let ttft: number | undefined;
  let acc = "";
  const stream = oa().responses.stream(
    {
      model: spec.model,
      reasoning: { effort: spec.effort },
      max_output_tokens: MAX_TOKENS[call.role] + (spec.effort === "none" ? 0 : 6000),
      input: [
        { role: "system", content: call.shared },
        { role: "system", content: call.persona },
        { role: "user", content: call.user },
      ],
      text: { format: { type: "json_schema", name: call.name, schema: jsonSchemaOf(call.schema), strict: true } },
    },
    { signal: call.signal },
  );
  for await (const ev of stream) {
    if (ev.type === "response.output_text.delta") {
      ttft ??= Date.now() - t0;
      acc += ev.delta;
      call.onText?.(acc);
    }
  }
  const r = await stream.finalResponse();
  if (r.status === "incomplete") throw new Error(`openai incomplete: ${r.incomplete_details?.reason ?? "unknown"}`);
  const usage: LlmUsage = {
    provider: "openai",
    model: spec.model,
    inputTokens: r.usage?.input_tokens ?? 0,
    cachedInputTokens: r.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    ms: Date.now() - t0,
    ttftMs: ttft,
  };
  return { data: call.schema.parse(JSON.parse(r.output_text || acc)), usage };
}

async function claudeStream<T extends z.ZodType>(call: StreamJsonCall<T>, spec: Extract<Target, { provider: "claude" }>): Promise<{ data: z.infer<T>; usage: LlmUsage }> {
  const t0 = Date.now();
  let ttft: number | undefined;
  let acc = "";
  const stream = claude().beta.messages.stream(
    {
      model: spec.model,
      max_tokens: MAX_TOKENS[call.role] + 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        { type: "text", text: call.shared, cache_control: { type: "ephemeral" } },
        { type: "text", text: call.persona },
      ],
      thinking: { type: "adaptive" },
      output_config: { effort: spec.effort, format: { type: "json_schema", schema: jsonSchemaOf(call.schema) } },
      messages: [{ role: "user", content: call.user }],
    },
    { signal: call.signal },
  );
  stream.on("text", (delta) => {
    ttft ??= Date.now() - t0;
    acc += delta;
    call.onText?.(acc);
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("claude refusal");
  if (msg.stop_reason === "max_tokens") throw new Error("claude max_tokens");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const usage: LlmUsage = {
    provider: "claude",
    model: msg.model ?? spec.model,
    inputTokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0),
    cachedInputTokens: msg.usage.cache_read_input_tokens ?? 0,
    outputTokens: msg.usage.output_tokens,
    ms: Date.now() - t0,
    ttftMs: ttft,
  };
  return { data: call.schema.parse(JSON.parse(text)), usage };
}

/** Retry on schema/JSON/transient errors (not on abort). */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, tries = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (isAbort(e) || (e instanceof ProvidersUnavailableError && !e.retryable)) throw e;
      console.warn(`[question] attempt ${i + 1} failed:`, e instanceof Error ? e.message.slice(0, 200) : e);
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

/** Extract the (possibly partial) values of every `"question": "..."` field in a streaming JSON buffer. */
export function partialQuestions(acc: string): string[] {
  const out: string[] = [];
  const re = /"question"\s*:\s*"((?:[^"\\]|\\.)*)(")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(acc))) {
    let s = m[1];
    if (s.endsWith("\\")) s = s.slice(0, -1);
    try {
      out.push(JSON.parse(`"${s}"`) as string);
    } catch {
      out.push(s);
    }
  }
  return out;
}
