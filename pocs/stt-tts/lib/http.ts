import "server-only";
import { ProviderError } from "./server";

/** Map thrown errors to JSON responses with a Korean message the UI can show as-is. */
export function errorResponse(e: unknown): Response {
  if (e instanceof ProviderError) {
    const headers: Record<string, string> = {};
    if (e.retryAfterSec) headers["retry-after"] = String(e.retryAfterSec);
    return Response.json({ error: e.message, status: e.status, retryAfterSec: e.retryAfterSec }, { status: e.status, headers });
  }
  console.error("[stt-tts]", e);
  return Response.json({ error: `서버 오류: ${String((e as Error)?.message ?? e).slice(0, 200)}` }, { status: 500 });
}

/**
 * Reject obvious cross-site calls (the token / provider quota must not be usable by other sites).
 *
 * - lenient (transcribe / tts): a request without Fetch-Metadata (curl, server-to-server) is allowed.
 * - strict (token): the caller must prove it is our own page — `sec-fetch-site: same-origin`, or, for
 *   browsers without Fetch-Metadata, an `Origin` header equal to this host. A bare curl/script call
 *   gets 403. (Headers can still be forged by a non-browser client; the real app needs user auth.)
 */
export function sameOrigin(req: Request, opts: { strict?: boolean } = {}): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || (!opts.strict && site === "none");
  if (!opts.strict) return true;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------------
// Fixed-window rate limit per client (in-memory; resets on dev-server restart). Caps how fast a
// single client can burn the provider quota through these routes.
// ------------------------------------------------------------------------------------------------
const windows = new Map<string, { start: number; count: number }>();

export const RATE_LIMITS = {
  token: { limit: 10, windowMs: 60_000 }, // one token per Live session (+ reconnects)
  transcribe: { limit: 40, windowMs: 60_000 }, // ~1 VAD segment every 1.5s
  tts: { limit: 30, windowMs: 60_000 }, // cache hits included
} as const;

function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local").slice(0, 64);
}

/** Returns a 429 Response when the client exceeded the bucket, else null. */
export function rateLimit(req: Request, bucket: keyof typeof RATE_LIMITS): Response | null {
  const { limit, windowMs } = RATE_LIMITS[bucket];
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  let w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    w = { start: now, count: 0 };
    windows.set(key, w);
    if (windows.size > 5_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
  }
  if (++w.count <= limit) return null;
  const retryAfterSec = Math.max(1, Math.ceil((w.start + windowMs - now) / 1000));
  return Response.json(
    { error: `요청이 너무 잦습니다 (분당 ${limit}회 제한). ${retryAfterSec}초 후 다시 시도해 주세요.`, status: 429, retryAfterSec, local: true },
    { status: 429, headers: { "retry-after": String(retryAfterSec) } },
  );
}

/** Guard for every stt-tts route: origin check, then rate limit. */
export function guard(req: Request, bucket: keyof typeof RATE_LIMITS, opts: { strict?: boolean } = {}): Response | null {
  if (!sameOrigin(req, opts)) return Response.json({ error: "forbidden" }, { status: 403 });
  return rateLimit(req, bucket);
}
