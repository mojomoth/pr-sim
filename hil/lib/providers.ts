import "server-only";
import { claude, gemini, openai } from "@/lib/ai";

// One tiny call per provider to tell the HIL tester which LLM providers work right now.
// Results are cached for 60s so repeated page loads don't burn the Gemini free-tier quota.

export type ProviderState = {
  id: "claude" | "openai" | "gemini";
  label: string;
  model: string;
  ok: boolean;
  ms: number;
  status: number | null;
  reason: string;
};
export type ProviderReport = { checkedAt: string; cached: boolean; providers: ProviderState[] };

const TTL_MS = 60_000;
let cache: { at: number; report: ProviderReport } | null = null;
let inflight: Promise<ProviderReport> | null = null;

function reasonFor(id: ProviderState["id"], status: number | null, message: string): string {
  const m = message.toLowerCase();
  if (id === "claude" && (status === 400 || status === 403) && m.includes("usage limit")) return "사용 한도 초과 (2026-12-01 복구 예정)";
  if (id === "openai" && m.includes("credit")) return "크레딧 소진 — 결제 페이지에서 충전 필요";
  if (status === 429) return "요청 한도 초과(429) — 무료 등급 일일·분당 한도일 수 있음";
  if (status === 503) return "제공자 과부하(503)";
  if (status === 401) return "키 인증 실패(401)";
  return `오류${status ? ` ${status}` : ""}`;
}

async function probe(
  id: ProviderState["id"],
  label: string,
  model: string,
  call: () => Promise<unknown>,
): Promise<ProviderState> {
  const t = Date.now();
  try {
    await call();
    return { id, label, model, ok: true, ms: Date.now() - t, status: 200, reason: "정상" };
  } catch (e) {
    const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : null;
    const message = String((e as Error)?.message ?? e);
    return { id, label, model, ok: false, ms: Date.now() - t, status, reason: reasonFor(id, status, message) };
  }
}

async function run(): Promise<ProviderReport> {
  const signal = AbortSignal.timeout(20_000);
  const providers = await Promise.all([
    probe("claude", "Claude", "claude-haiku-5-5", () =>
      claude().messages.create(
        { model: "claude-haiku-5-5", max_tokens: 64, thinking: { type: "disabled" }, messages: [{ role: "user", content: "Reply with OK." }] },
        { signal, maxRetries: 0 },
      ),
    ),
    probe("openai", "OpenAI", "gpt-5.4-nano", () =>
      openai().responses.create({ model: "gpt-5.4-nano", input: "Reply with OK." }, { signal, maxRetries: 0 }),
    ),
    probe("gemini", "Gemini", "gemini-3.5-flash-lite", () =>
      gemini().models.generateContent({ model: "gemini-3.5-flash-lite", contents: "Reply with OK.", config: { abortSignal: signal } }),
    ),
  ]);
  return { checkedAt: new Date().toISOString(), cached: false, providers };
}

export async function checkProviders(force = false): Promise<ProviderReport> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return { ...cache.report, cached: true };
  inflight ??= run().finally(() => {
    inflight = null;
  });
  const report = await inflight;
  cache = { at: Date.now(), report };
  return report;
}

