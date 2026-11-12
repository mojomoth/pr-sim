import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// Process-wide provider health used by the LLM chain (llm.ts).
//
//   billing  — the account cannot be used until a human acts (Claude usage cap, OpenAI credits gone,
//              bad key). The provider is skipped for `BILLING_RECHECK_MS` and then probed again, so a
//              top-up is picked up without restarting the dev server.
//   transient — rate limit / overload / 5xx / network: skip it for THIS call only (next provider in chain).
//   other    — schema/JSON/refusal etc.: also falls through to the next provider for this call.

export type ProviderName = "claude" | "openai" | "gemini";
type ErrKind = "billing" | "transient" | "other";

const BILLING_RECHECK_MS = 10 * 60_000;
const g = globalThis as unknown as { __questionProviderDown?: Map<ProviderName, { reason: string; until: number }> };
const down = (g.__questionProviderDown ??= new Map());

export function markDown(p: ProviderName, reason: string, ms = BILLING_RECHECK_MS) {
  // a known reopening date (Claude usage cap) still gets re-probed at least every 6 h
  ms = Math.max(BILLING_RECHECK_MS, Math.min(ms, 6 * 3600_000));
  down.set(p, { reason, until: Date.now() + ms });
  console.warn(`[question] ${p} skipped for ${Math.round(ms / 60000)} min: ${reason}`);
}
export function downReason(p: ProviderName): string | undefined {
  const d = down.get(p);
  if (!d) return undefined;
  if (d.until <= Date.now()) {
    down.delete(p);
    return undefined;
  }
  return d.reason;
}
export const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || e instanceof Anthropic.APIUserAbortError || e instanceof OpenAI.APIUserAbortError);

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  if (typeof s === "number") return s;
  const m = String((e as Error)?.message ?? "").match(/"code":\s*(\d{3})/);
  return m ? Number(m[1]) : undefined;
}

/** Classify a provider error and give a short Korean reason for UI / logs. */
export function classify(p: ProviderName, e: unknown): { kind: ErrKind; short: string; untilMs?: number } {
  if (p === "claude") {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { kind: "billing", short: "인증 실패(키 확인)" };
    if (e instanceof Anthropic.BadRequestError && /usage limit|credit balance|billing/i.test(e.message)) {
      const d = e.message.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
      return { kind: "billing", short: `사용 한도 초과${d ? `(${d} 재개)` : ""}`, untilMs: d ? Date.parse(`${d}T00:00:00Z`) - Date.now() : undefined };
    }
    if (e instanceof Anthropic.RateLimitError) return { kind: "transient", short: "요청 한도(429)" };
    if (e instanceof Anthropic.InternalServerError) return { kind: "transient", short: e.status === 529 ? "과부하(529)" : `서버 오류(${e.status})` };
    if (e instanceof Anthropic.APIConnectionError) return { kind: "transient", short: "연결 실패" };
  }
  if (p === "openai") {
    // Duck-typed: errors raised inside responses.stream() are not always the specific subclasses.
    const st = statusOf(e);
    const code = (e as { code?: unknown })?.code;
    const msg = e instanceof Error ? e.message : String(e);
    if (st === 401 || st === 403) return { kind: "billing", short: "인증 실패(키 확인)" };
    if (code === "insufficient_quota" || /no credits|insufficient_quota|exceeded your current quota/i.test(msg)) return { kind: "billing", short: "크레딧 소진(충전 필요)" };
    if (st === 429) return { kind: "transient", short: "요청 한도(429)" };
    if (st && st >= 500) return { kind: "transient", short: `서버 오류(${st})` };
    if (e instanceof OpenAI.APIConnectionError) return { kind: "transient", short: "연결 실패" };
  }
  if (p === "gemini") {
    const st = statusOf(e);
    if (st === 429) return { kind: "transient", short: "무료 한도 초과(429)" };
    if (st === 503) return { kind: "transient", short: "과부하(503)" };
    if (st === 401 || st === 403) return { kind: "billing", short: "인증 실패(키 확인)" };
    if (st && st >= 500) return { kind: "transient", short: `서버 오류(${st})` };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { kind: "other", short: msg.slice(0, 80) };
}

/** Every provider in the chain failed. The message is short Korean, safe to show as-is. */
export class ProvidersUnavailableError extends Error {
  retryable = false;
  constructor(public reasons: Partial<Record<ProviderName, string>>) {
    const parts = (Object.entries(reasons) as [ProviderName, string][]).map(([p, r]) => `${p === "claude" ? "Claude" : p === "openai" ? "OpenAI" : "Gemini"} ${r}`);
    super(`AI 모델을 지금 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요. (${parts.join(" · ")})`);
    this.name = "ProvidersUnavailableError";
  }
}

/** Map any thrown error to a short Korean message for the UI (no raw provider URLs). */
export function friendlyError(e: unknown, fallbackPrefix = "오류"): string {
  if (e instanceof ProvidersUnavailableError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/no credits|insufficient_quota/i.test(msg)) return "OpenAI 크레딧이 소진되었습니다(충전 필요).";
  if (/usage limit/i.test(msg)) return "Claude 사용 한도에 도달했습니다.";
  if (/exceeded your current quota|RESOURCE_EXHAUSTED/i.test(msg)) return "Gemini 무료 사용 한도를 넘었습니다. 잠시 후 다시 시도하세요.";
  // strip URLs so a long billing link never overflows a card
  return `${fallbackPrefix}: ${msg.replace(/https?:\/\/\S+/g, "").slice(0, 200)}`;
}
