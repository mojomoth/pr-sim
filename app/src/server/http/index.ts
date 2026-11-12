import "server-only";
import type { z } from "zod";
import { MAX_BODY_BYTES, waitText, type ApiErrorBody, type ApiErrorCode } from "../types";

// Shared plumbing for every /api route: origin check (+ ALLOWED_ORIGINS CORS), in-memory rate limit, 4MB JSON body cap + zod,
// one error shape ({ error: { code, message, retryAfterSec? } }, Korean message) and NDJSON streaming.

export const NO_STORE = { "cache-control": "no-store" } as const;

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  forbidden: 403,
  too_large: 413,
  unsupported: 422,
  rate_limited: 429,
  providers_unavailable: 503,
  timeout: 504,
  upstream: 502,
};

const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  bad_request: "요청 형식이 올바르지 않아요.",
  forbidden: "허용되지 않은 요청이에요.",
  too_large: "자료가 너무 길어요. 최대 120쪽·15만 자까지 쓸 수 있어요.",
  unsupported: "지원하지 않는 자료예요.",
  rate_limited: "요청이 많아요. 잠시 뒤 다시 시도해 주세요.",
  providers_unavailable: "AI 모델을 지금 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요.",
  timeout: "응답 시간이 초과됐어요. 다시 시도해 주세요.",
  upstream: "AI 서비스 오류가 났어요. 다시 시도해 주세요.",
};

const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set(["rate_limited", "providers_unavailable", "timeout", "upstream"]);

// Plain fields (no constructor parameter properties) so Node's type stripping can load this file in tests.
export class ApiError extends Error {
  code: ApiErrorCode;
  retryAfterSec?: number;
  issues?: { path: string; message: string }[];
  /** Hint for the client to do the job on the device (/api/tts → speechSynthesis). */
  fallback?: "browser";
  constructor(code: ApiErrorCode, message?: string, retryAfterSec?: number, issues?: { path: string; message: string }[]) {
    super(message ?? (code === "rate_limited" && retryAfterSec ? `요청이 많아요. ${waitText(retryAfterSec)} 뒤 다시 시도해 주세요.` : DEFAULT_MESSAGE[code]));
    this.name = "ApiError";
    this.code = code;
    this.retryAfterSec = retryAfterSec;
    this.issues = issues;
  }
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || /timed? ?out/i.test(e.message));

/** Any thrown value → ApiError. Module errors are recognised by name so this file does not import every module. */
export function toApiError(e: unknown, tag: string): ApiError {
  if (e instanceof ApiError) return e;
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);
  if (name === "LlmUnavailableError" || name === "ProvidersUnavailableError") return new ApiError("providers_unavailable");
  if (isTimeout(e)) return new ApiError("timeout");
  console.error(`[api/${tag}]`, name || "Error", msg.replace(/https?:\/\/\S+/g, "").slice(0, 300));
  return new ApiError("upstream");
}

export function errorResponse(e: unknown, tag: string): Response {
  const err = toApiError(e, tag);
  const body: ApiErrorBody & { error: { issues?: ApiError["issues"] } } = {
    error: { code: err.code, message: err.message, ...(err.retryAfterSec ? { retryAfterSec: err.retryAfterSec } : {}), ...(err.issues ? { issues: err.issues } : {}), ...(err.fallback ? { fallback: err.fallback } : {}) },
  };
  const headers: Record<string, string> = { ...NO_STORE };
  if (err.retryAfterSec) headers["retry-after"] = String(err.retryAfterSec);
  return Response.json(body, { status: STATUS[err.code], headers });
}

/**
 * Origins outside this host that may call the API (e.g. a future native build: `capacitor://localhost`),
 * from env ALLOWED_ORIGINS (comma list, exact `scheme://host[:port]`). Unset → same-origin only.
 */
function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin || !process.env.ALLOWED_ORIGINS) return null;
  const list = process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

/**
 * Reject cross-site calls (provider quota must not be usable by other sites).
 * An Origin on the ALLOWED_ORIGINS list always passes.
 * lenient: a request without Fetch-Metadata (curl, server-to-server) passes.
 * strict (token): needs `sec-fetch-site: same-origin`, or an Origin equal to this host.
 * Headers can be forged by a non-browser client; real protection needs user auth.
 */
function sameOrigin(req: Request, strict = false): boolean {
  if (allowedOrigin(req)) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || (!strict && site === "none");
  if (!strict) return true;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const EXPOSE = "x-provider, x-model, x-voice, x-duration, retry-after";

/** Wrap a route's POST so responses to an allow-listed Origin carry CORS headers (no-op when ALLOWED_ORIGINS is unset). */
export function cors(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const res = await handler(req);
    const origin = allowedOrigin(req);
    if (origin) {
      res.headers.set("access-control-allow-origin", origin);
      res.headers.set("access-control-expose-headers", EXPOSE);
      res.headers.append("vary", "Origin");
    }
    return res;
  };
}

/** OPTIONS for every route: CORS preflight for an allow-listed Origin, otherwise what Next answers by default (204 + Allow). */
export function preflight(req: Request): Response {
  const origin = allowedOrigin(req);
  const headers: Record<string, string> = { allow: "OPTIONS, POST" };
  if (origin) {
    Object.assign(headers, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": req.headers.get("access-control-request-headers") ?? "content-type",
      "access-control-max-age": "600",
      vary: "Origin",
    });
  }
  return new Response(null, { status: 204, headers });
}

// Fixed-window limit per client and route (instance memory: a soft guard only on serverless).
const LIMITS = {
  token: 10,
  tts: 30,
  judges: 10,
  wiki: 6,
  questions: 10,
  followup: 40,
  report: 6,
} as const;
export type Bucket = keyof typeof LIMITS;
const WINDOW_MS = 60_000;
const windows = new Map<string, { start: number; count: number }>();

function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local").slice(0, 64);
}

/** Origin check + rate limit. Returns an error Response, or null when the call may proceed. */
export function guard(req: Request, bucket: Bucket, strict = false): Response | null {
  if (!sameOrigin(req, strict)) return errorResponse(new ApiError("forbidden"), bucket);
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  let w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    w = { start: now, count: 0 };
    windows.set(key, w);
    if (windows.size > 5_000) for (const [k, v] of windows) if (now - v.start >= WINDOW_MS) windows.delete(k);
  }
  if (++w.count <= LIMITS[bucket]) return null;
  return errorResponse(new ApiError("rate_limited", undefined, Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000))), bucket);
}

const TOO_LARGE_BODY = "보낼 자료가 너무 커요. 쪽수가 적은 자료로 다시 시도해 주세요.";

/** Body bytes, stopping as soon as MAX_BODY_BYTES is passed (a chunked request has no content-length). */
async function readBody(req: Request): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new ApiError("too_large", TOO_LARGE_BODY);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        reader.cancel().catch(() => {});
        throw new ApiError("too_large", TOO_LARGE_BODY);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("bad_request");
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return buf;
}

/** Read a JSON body (≤ 4MB, enforced while streaming) and validate it. Throws ApiError too_large / bad_request. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const buf = await readBody(req);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new ApiError("bad_request", "요청 본문이 올바른 JSON이 아니에요.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      "bad_request",
      undefined,
      undefined,
      parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}

/**
 * NDJSON stream: `work` sends events; a thrown error becomes the last line
 * `{ type: "error", code, message, retryable, retryAfterSec? }`.
 */
export function ndjson(tag: string, work: (send: (event: object) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: object) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false; // client went away
        }
      };
      try {
        await work(send);
      } catch (e) {
        const err = toApiError(e, tag);
        send({ type: "error", code: err.code, message: err.message, retryable: RETRYABLE.has(err.code), ...(err.retryAfterSec ? { retryAfterSec: err.retryAfterSec } : {}) });
      } finally {
        if (open) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", ...NO_STORE, "x-accel-buffering": "no" } });
}
