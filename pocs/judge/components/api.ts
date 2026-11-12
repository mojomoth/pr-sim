// Client-side API helpers for /api/judge.
import type { Temperament } from "@/lib/types";
import { JUDGE_ERROR_MESSAGE, type JudgeErrorBody, type JudgeErrorKind } from "../lib/errors";
import type { ImageQuality, JudgeRecord } from "../lib/model";

export type UiError = JudgeErrorBody["error"];

export function toUiError(e: unknown): UiError {
  if (e && typeof e === "object" && "kind" in e && "title" in e) return e as UiError;
  const kind: JudgeErrorKind = "unknown";
  return { kind, message: e instanceof Error ? e.message : String(e), ...JUDGE_ERROR_MESSAGE[kind] };
}

export async function fetchJudges(): Promise<JudgeRecord[]> {
  const r = await fetch("/api/judge", { cache: "no-store" });
  if (!r.ok) throw new Error(`list failed: ${r.status}`);
  return (await r.json()).judges;
}

export async function createJudge(body: { temperament: Temperament; quality: ImageQuality; replaceId?: string; simulateError?: JudgeErrorKind }): Promise<JudgeRecord> {
  let r: Response;
  try {
    r = await fetch("/api/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    throw toUiError(e);
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw toUiError(data?.error ?? new Error(`HTTP ${r.status}`));
  return data as JudgeRecord;
}

export async function removeJudge(id: string) {
  const r = await fetch(`/api/judge/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error(`delete failed: ${r.status}`);
}

export type PanelEvent =
  | { type: "start"; slots: { slot: number; temperament: Temperament }[] }
  | { type: "judge"; slot: number; judge: JudgeRecord }
  | { type: "error"; slot: number; temperament: Temperament; error: UiError }
  | { type: "done"; ms: number };

/** POST /api/judge/panel and invoke onEvent for each NDJSON line as it streams in. */
export async function streamPanel(body: { temperaments?: Temperament[]; quality: ImageQuality }, onEvent: (e: PanelEvent) => void) {
  const r = await fetch("/api/judge/panel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) {
    const data = await r.json().catch(() => null);
    throw toUiError(data?.error ?? new Error(`HTTP ${r.status}`));
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as PanelEvent);
    }
  }
}
