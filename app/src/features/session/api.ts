// Fetch helpers for the 7 API routes (docs/wiki/api-contract.md). Base URL from platform config.
// Every failure becomes an ApiError whose `message` is Korean and can be shown as is.
// Aborts (caller's AbortSignal) are re-thrown untouched: check `e.name === "AbortError"`.
import { apiUrl } from "@/platform/config";
import { MAX_BODY_BYTES, waitText, type ApiErrorBody, type ApiErrorCode, type DocInput } from "@/server/types";
import type { JudgeEvent, RollAvoid } from "@/server/judge/types";
import type { WikiEvent } from "@/server/wiki/types";
import type { FollowUpRequest, FollowUpResult, GenerateEvent, GenerateInput } from "@/server/question/types";
import type { ProgressEvent, ReportInput } from "@/server/report/types";
import type { Temperament, TtsRequest } from "./types";


export type ClientErrorCode = ApiErrorCode | "network";

const DEFAULT_MESSAGE: Record<ClientErrorCode, string> = {
  bad_request: "요청 형식이 올바르지 않아요.",
  forbidden: "허용되지 않은 요청이에요.",
  too_large: "자료가 너무 길어요. 최대 120쪽·15만 자까지 쓸 수 있어요.",
  unsupported: "지원하지 않는 자료예요.",
  rate_limited: "요청이 많아요. 잠시 뒤 다시 시도해 주세요.",
  providers_unavailable: "AI 모델을 지금 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요.",
  timeout: "응답 시간이 초과됐어요. 다시 시도해 주세요.",
  upstream: "AI 서비스에 오류가 생겼어요. 다시 시도해 주세요.",
  network: "서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
};

const RETRYABLE = new Set<ClientErrorCode>(["rate_limited", "providers_unavailable", "timeout", "upstream", "network"]);

export { waitText };

export class ApiError extends Error {
  readonly retryable: boolean;
  code: ClientErrorCode;
  retryAfterSec?: number;
  status?: number;
  /** Server hint: do this on the device instead (e.g. /api/tts → speak with the browser voice). */
  fallback?: "browser";
  // Plain fields, not parameter properties, so unit tests can load this file with Node type-stripping.
  constructor(code: ClientErrorCode, message?: string, retryAfterSec?: number, status?: number, fallback?: "browser") {
    super(message || (code === "rate_limited" && retryAfterSec ? `요청이 많아요. ${waitText(retryAfterSec)} 뒤 다시 시도해 주세요.` : DEFAULT_MESSAGE[code]));
    this.name = "ApiError";
    this.code = code;
    this.retryAfterSec = retryAfterSec;
    this.status = status;
    this.fallback = fallback;
    this.retryable = RETRYABLE.has(code);
  }
}

const STATUS_CODE: Record<number, ApiErrorCode> = { 400: "bad_request", 403: "forbidden", 413: "too_large", 422: "unsupported", 429: "rate_limited", 503: "providers_unavailable", 504: "timeout" };

/** "120초 뒤" in a server message → "약 2분 뒤". */
function humanizeSeconds(message: string): string {
  return message.replace(/(\d{2,})\s*초/g, (m, n: string) => (Number(n) >= 60 ? waitText(Number(n)) : m));
}

async function errorFrom(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
  const header = Number(res.headers.get("retry-after"));
  const retryAfterSec = body?.error?.retryAfterSec ?? (Number.isFinite(header) && header > 0 ? header : undefined);
  const code = body?.error?.code ?? STATUS_CODE[res.status] ?? "upstream";
  const message = body?.error?.message ? humanizeSeconds(body.error.message) : undefined;
  const hint = (body?.error as { fallback?: unknown } | undefined)?.fallback ?? (body as { fallback?: unknown } | null)?.fallback;
  return new ApiError(code, message, retryAfterSec, res.status, hint === "browser" ? "browser" : undefined);
}

function isAbort(e: unknown) {
  return (e as { name?: string })?.name === "AbortError";
}

/** POST JSON. Returns the Response when ok, throws ApiError otherwise. */
async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const json = body === undefined ? undefined : JSON.stringify(body);
  if (json && new Blob([json]).size > MAX_BODY_BYTES) {
    throw new ApiError("too_large", "보낼 자료가 너무 커요. 쪽수가 적은 자료로 다시 시도해 주세요.");
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: "POST",
      headers: json ? { "content-type": "application/json" } : undefined,
      body: json,
      signal,
      cache: "no-store",
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    if ((e as { name?: string })?.name === "TimeoutError") throw new ApiError("timeout");
    throw new ApiError("network");
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

/** Caller's signal + a hard timeout (route maxDuration + slack). */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal && "any" in AbortSignal ? AbortSignal.any([signal, t]) : (signal ?? t);
}

type Terminal = { type: "done" };

/**
 * Read an NDJSON stream, calling onEvent for every line. Resolves with the "done" event.
 * A final `{type:"error"}` line (one without `slot` / `judgeId`, i.e. not a per-judge error) throws ApiError;
 * a stream that ends without "done" throws ApiError("upstream").
 */
async function readNdjson<E extends { type: string }>(res: Response, onEvent?: (e: E) => void): Promise<Extract<E, Terminal>> {
  if (!res.body) throw new ApiError("upstream");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let done: Extract<E, Terminal> | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let ev: E & { slot?: unknown; judgeId?: unknown; code?: ApiErrorCode; message?: string; retryAfterSec?: number };
    try {
      ev = JSON.parse(line);
    } catch {
      return; // partial / garbage line: ignore
    }
    if (ev.type === "error" && ev.slot === undefined && ev.judgeId === undefined) {
      throw new ApiError(ev.code ?? "upstream", ev.message ? humanizeSeconds(ev.message) : undefined, ev.retryAfterSec);
    }
    onEvent?.(ev);
    if (ev.type === "done") done = ev as Extract<E, Terminal>;
  };
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    handle(buf);
  } catch (e) {
    void reader.cancel().catch(() => {});
    if (e instanceof ApiError || isAbort(e)) throw e;
    throw new ApiError("network", "응답을 받는 중에 연결이 끊겼어요. 다시 시도해 주세요.");
  }
  if (!done) throw new ApiError("upstream", "응답이 중간에 끊겼어요. 다시 시도해 주세요.");
  return done;
}

type Stream<E extends { type: string }> = { onEvent?: (e: E) => void; signal?: AbortSignal };

// ── 1. POST /api/stt/token ──
export interface SttToken {
  token: string;
  model: string;
  expiresAt: string;
  config?: Record<string, unknown>;
}
export async function getSttToken(signal?: AbortSignal): Promise<SttToken> {
  const res = await post("/api/stt/token", undefined, withTimeout(signal, 15_000));
  return (await res.json()) as SttToken;
}

// ── 2. POST /api/tts → audio/wav ──
export interface TtsResult {
  blob: Blob;
  provider: string;
  voice: string;
  model: string;
  durationSec: number;
}
/**
 * True when a fetchTts() failure should be voiced on the device instead (platform.audio.speak):
 * the server's {fallback:"browser"} hint, provider quota/outage, network, timeout or any 5xx.
 * False for aborts and request errors (400/403/413) that a browser voice wouldn't fix.
 */
export function ttsFallsBackToBrowser(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.fallback === "browser" || e.retryable || (e.status ?? 0) >= 500;
}

export async function fetchTts(body: TtsRequest, signal?: AbortSignal): Promise<TtsResult> {
  const res = await post("/api/tts", body, withTimeout(signal, 70_000));
  const blob = await res.blob().catch((e: unknown) => {
    if (isAbort(e)) throw e;
    throw new ApiError("network", "음성을 받는 중에 연결이 끊겼어요.");
  });
  return {
    blob,
    provider: res.headers.get("x-provider") ?? "",
    voice: res.headers.get("x-voice") ?? "",
    model: res.headers.get("x-model") ?? "",
    durationSec: Number(res.headers.get("x-duration") || 0),
  };
}

// ── 3. POST /api/judges (NDJSON) ──
export async function streamJudges(body: { temperaments: Temperament[]; avoid?: RollAvoid }, opts: Stream<JudgeEvent> = {}) {
  return readNdjson<JudgeEvent>(await post("/api/judges", body, opts.signal), opts.onEvent);
}

// ── 4. POST /api/wiki (NDJSON) ──
export async function streamWiki(doc: DocInput, opts: Stream<WikiEvent> = {}) {
  return readNdjson<WikiEvent>(await post("/api/wiki", { doc }, opts.signal), opts.onEvent);
}

// ── 5. POST /api/questions (NDJSON) ──
export async function streamQuestions(body: GenerateInput, opts: Stream<GenerateEvent> = {}) {
  return readNdjson<GenerateEvent>(await post("/api/questions", body, opts.signal), opts.onEvent);
}

// ── 6. POST /api/questions/followup ──
export async function postFollowup(body: FollowUpRequest, signal?: AbortSignal): Promise<FollowUpResult> {
  const res = await post("/api/questions/followup", body, withTimeout(signal, 70_000));
  return (await res.json()) as FollowUpResult;
}

// ── 7. POST /api/report (NDJSON) ──
export async function streamReport(body: { session: ReportInput; provider?: string }, opts: Stream<ProgressEvent> = {}) {
  return readNdjson<ProgressEvent>(await post("/api/report", body, opts.signal), opts.onEvent);
}
