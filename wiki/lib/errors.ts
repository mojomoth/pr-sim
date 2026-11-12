// Provider-error → Korean message mapping. Pure, safe to import from client components
// (also used to tidy raw English provider errors stored in older status.json files).

export type LlmErrorCode = "quota" | "auth" | "rate_limit" | "timeout" | "network" | "unavailable" | "unknown";

const HINT: Record<LlmErrorCode, string> = {
  quota: "AI 제공자의 크레딧·사용 한도가 소진됐습니다. 크레딧을 충전하거나 한도가 풀린 뒤 다시 시도하세요.",
  auth: "AI 제공자 API 키가 거부됐습니다. .env 의 키를 확인하세요.",
  rate_limit: "AI 제공자 요청이 일시적으로 몰렸습니다. 잠시 후 다시 시도하세요.",
  timeout: "AI 응답이 제한 시간 안에 오지 않았습니다. 다시 시도하세요.",
  network: "AI 제공자에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.",
  unavailable: "지금은 사용할 수 있는 AI 제공자가 없습니다. 크레딧·키를 확인한 뒤 다시 시도하세요.",
  unknown: "AI 호출이 실패했습니다. 다시 시도하세요.",
};

/** Classify an error message (works on SDK messages and on our own Korean messages). */
export function classifyLlmMessage(msg: string): LlmErrorCode | null {
  const m = msg.toLowerCase();
  if (/no credits|insufficient_quota|credit_balance|credit balance|usage limit|billing|exceeded your current quota|resource_exhausted|크레딧|사용 한도/.test(m)) return "quota";
  if (/\b401\b|\b403\b|invalid api key|incorrect api key|authentication|permission denied|api 키/.test(m)) return "auth";
  if (/\b429\b|rate limit|too many requests/.test(m)) return "rate_limit";
  if (/timed? ?out|timeout|aborted|abort|제한 시간/.test(m)) return "timeout";
  if (/econnrefused|enotfound|fetch failed|connection error|network|연결하지 못/.test(m)) return "network";
  if (/사용할 수 있는 ai 제공자/.test(m)) return "unavailable";
  return null;
}

/** A short Korean, user-facing message for an LLM/provider failure. Non-provider messages pass through. */
export function friendlyLlmError(msgOrErr: unknown): string {
  const msg = msgOrErr instanceof Error ? msgOrErr.message : String(msgOrErr ?? "");
  // our own messages start in Korean and are already user-facing
  if (/^(?:AI\s)?[\s\d.:·()-]*[가-힣]/.test(msg)) return msg;
  if (/invalid pdf|pdf structure|password/i.test(msg)) return "PDF 구조를 읽을 수 없습니다(손상·암호 PDF). 다른 파일로 시도하세요.";
  const code = classifyLlmMessage(msg);
  if (!code) return msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
  return HINT[code];
}

export function hintFor(code: LlmErrorCode): string {
  return HINT[code];
}

const NEXT: Record<LlmErrorCode, string> = {
  quota: "크레딧을 충전하거나 한도가 풀린 뒤 다시 시도하세요.",
  auth: ".env 의 API 키를 확인하세요.",
  network: "네트워크를 확인한 뒤 다시 시도하세요.",
  rate_limit: "잠시 후 다시 시도하세요.",
  timeout: "잠시 후 다시 시도하세요.",
  unavailable: "크레딧·키를 확인한 뒤 다시 시도하세요.",
  unknown: "잠시 후 다시 시도하세요.",
};
/** One short "what to do next" sentence for an error code. */
export function nextStep(code: LlmErrorCode): string {
  return NEXT[code];
}
