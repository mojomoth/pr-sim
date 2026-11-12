"use client";
// Browser-side helpers for the question API.
import type { DocKind, WikiDocSummary } from "@/wiki/lib/types";
import type { TranscriptSentence } from "@/lib/types";
import type { FollowUpResult, GenerateEvent, GenerateInput, QJudge, QuestionRun } from "../lib/types";

export interface SetupData {
  sample: { situation: string; presentationMinutes: number; qaMinutes: number; transcript: TranscriptSentence[]; judges: QJudge[] };
  script: TranscriptSentence[];
  docs: WikiDocSummary[];
  faces: QJudge[];
  defaults: { presentationDocId?: string; proposalDocId?: string };
  error?: string;
}
export type { DocKind };

export async function getSetup(): Promise<SetupData> {
  const r = await fetch("/api/question/setup", { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `설정 불러오기 실패 (${r.status})`);
  return j;
}

export async function ingestFixtures(): Promise<{ presentationDocId: string; proposalDocId: string; reused: boolean[]; ms: number }> {
  const r = await fetch("/api/question/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ingest-fixtures" }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "인제스트 실패");
  return j;
}

/** POST generate and dispatch each NDJSON event. Resolves when the stream ends. */
export async function streamGenerate(input: GenerateInput, onEvent: (e: GenerateEvent) => void, signal?: AbortSignal) {
  return streamNdjson("/api/question/generate", input, onEvent, signal);
}

/** Regenerate the failed judges of a run into the same run (same NDJSON events as generate). */
export async function streamRetry(body: { runId: string; judgeIds?: string[] }, onEvent: (e: GenerateEvent) => void, signal?: AbortSignal) {
  return streamNdjson("/api/question/retry", body, onEvent, signal);
}

async function streamNdjson(url: string, body: unknown, onEvent: (e: GenerateEvent) => void, signal?: AbortSignal) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error ?? `질문 생성 요청 실패 (${r.status})`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as GenerateEvent);
    }
  }
}

/** A fresh Q&A-session id (scopes the server-side thread / follow-up count / log). */
export const newAttemptId = () => `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function postFollowup(body: { runId: string; attemptId: string; judgeId: string; questionId: string; answer: string; remainingSec?: number }): Promise<FollowUpResult & { clientMs: number }> {
  const t0 = performance.now();
  const r = await fetch("/api/question/followup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `꼬리질문 판단 실패 (${r.status})`);
  return { ...j, clientMs: Math.round(performance.now() - t0) };
}

export interface TtsClip {
  blob: Blob;
  voice: string;
  model: string;
  provider: string;
  cached: boolean;
  durationSec: number;
  ms: number;
}
const ttsCache = new Map<string, Promise<TtsClip>>();

/** Judge voice for a line (memoized per text+voice in the tab; server caches on disk too). */
export function judgeTts(text: string, j: Pick<QJudge, "gender" | "age" | "temperament">): Promise<TtsClip> {
  const key = JSON.stringify([text, j.gender, j.age, j.temperament]);
  let p = ttsCache.get(key);
  if (!p) {
    p = (async () => {
      const t0 = performance.now();
      const r = await fetch("/api/question/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, gender: j.gender, age: j.age, temperament: j.temperament }) });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? `음성 생성 실패 (${r.status})`);
      }
      return {
        blob: await r.blob(),
        voice: r.headers.get("x-voice") ?? "",
        provider: r.headers.get("x-provider") ?? "gemini",
        model: r.headers.get("x-model") ?? "",
        cached: r.headers.get("x-cache") === "HIT",
        durationSec: Number(r.headers.get("x-duration") || 0),
        ms: Math.round(performance.now() - t0),
      };
    })();
    ttsCache.set(key, p);
    p.catch(() => ttsCache.delete(key));
  }
  return p;
}

export async function saveSessionApi(body: { runId: string; attemptId?: string; qa: unknown[] }): Promise<{ id: string; file: string; qa: number }> {
  const r = await fetch("/api/question/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "세션 저장 실패");
  return j;
}

export interface RunSummary {
  id: string;
  createdAt: string;
  situation: string;
  judges: { name: string; temperament: string }[];
  questions: number;
  provider?: string;
  qa: number;
  attempts: number;
  failedJudges: string[];
  complete: boolean;
}
export async function listRunsApi(): Promise<RunSummary[]> {
  const r = await fetch("/api/question/runs", { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "실행 목록 불러오기 실패");
  return j.runs;
}
export async function loadRunApi(id: string): Promise<QuestionRun> {
  const r = await fetch(`/api/question/runs/${id}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "실행 불러오기 실패");
  return j;
}
