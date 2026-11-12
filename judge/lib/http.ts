import "server-only";
import { ERROR_STATUS, JUDGE_ERROR_MESSAGE, JudgeGenError, type JudgeErrorBody } from "./errors";
import { isTemperament } from "./index";
import { QUALITIES, type ImageQuality } from "./model";
import type { JudgeErrorKind } from "./errors";
import type { Temperament } from "@/lib/types";

export function errorBody(e: unknown): { status: number; body: JudgeErrorBody } {
  const err = e instanceof JudgeGenError ? e : new JudgeGenError("unknown", e instanceof Error ? e.message : String(e));
  const m = JUDGE_ERROR_MESSAGE[err.kind];
  return { status: ERROR_STATUS[err.kind], body: { error: { kind: err.kind, message: err.message, title: m.title, hint: m.hint } } };
}

export function errorResponse(e: unknown) {
  const { status, body } = errorBody(e);
  if (body.error.kind !== "bad_request") console.error("[judge]", body.error.kind, body.error.message);
  return Response.json(body, { status });
}

const SIM_KINDS: JudgeErrorKind[] = ["moderation", "rate_limit", "auth", "timeout", "server", "unknown"];

/** Parse the shared POST body: { temperament, quality?, simulateError? } */
export function parseCommon(raw: unknown): { quality?: ImageQuality; simulateError?: JudgeErrorKind } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const quality = QUALITIES.includes(b.quality as ImageQuality) ? (b.quality as ImageQuality) : undefined;
  const sim = process.env.NODE_ENV !== "production" && SIM_KINDS.includes(b.simulateError as JudgeErrorKind) ? (b.simulateError as JudgeErrorKind) : undefined;
  return { quality, simulateError: sim };
}

export function parseTemperament(v: unknown): Temperament {
  if (!isTemperament(v)) throw new JudgeGenError("bad_request", "temperament must be one of friendly | strict | aggressive");
  return v;
}

/** Read a JSON object body. Anything else (invalid JSON, null, array, primitive) → 400 bad_request. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let v: unknown;
  try {
    v = await req.json();
  } catch {
    throw new JudgeGenError("bad_request", "invalid JSON body");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new JudgeGenError("bad_request", "JSON body must be an object");
  return v as Record<string, unknown>;
}
