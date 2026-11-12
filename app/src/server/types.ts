// Cross-module contracts shared by the API routes and the client (type-only safe: no server imports).
import type { KeyNumber, WikiPage } from "./wiki/types";

export type Temperament = "friendly" | "strict" | "aggressive"; // 친절함 | 빡셈 | 공격적
export const TEMPERAMENT_LABEL: Record<Temperament, string> = {
  friendly: "친절함",
  strict: "빡셈",
  aggressive: "공격적",
};

export type Gender = "male" | "female";

export interface JudgePersona {
  id: string;
  name: string; // Korean given name, e.g. "준호"
  temperament: Temperament;
  gender?: Gender;
  age?: number;
  imageUrl?: string;
}

/** One finalized STT sentence. t = seconds since the phase started, slide = page shown then (1-based). */
export interface TranscriptSentence {
  id: string;
  t: number;
  text: string;
  phase: "presentation" | "qa";
  slide?: number;
}

export interface QAItem {
  judge: Pick<JudgePersona, "id" | "name" | "temperament">;
  question: string;
  answer: string;
  askedAt?: number;
}

export type DocRole = "presentation" | "proposal";

/** One uploaded document as the server sees it: page texts extracted in the browser (+ its wiki once built). */
export interface DocInput {
  role: DocRole;
  docId: string; // sha256(PDF bytes) first 16 hex chars
  filename: string;
  pageTexts: string[]; // index 0 = p.1
  wiki?: WikiPage[];
  keyNumbers?: KeyNumber[];
}

export type ApiErrorCode = "bad_request" | "forbidden" | "too_large" | "unsupported" | "rate_limited" | "providers_unavailable" | "timeout" | "upstream";

/** Error body of every route. `message` is Korean and can be shown as is. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; retryAfterSec?: number };
}

/** Caps checked on both sides: the client before sending, the server again on every request. */
export const MAX_BODY_BYTES = 4_000_000; // Vercel request body limit is 4.5MB
export const MAX_DOC_PAGES = 120;
export const MAX_DOC_CHARS = 150_000;

/** 45 → "45초", 130 → "약 2분", 7200 → "약 2시간" (retry hints people can read, not raw seconds). */
export function waitText(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))}초`;
  if (sec < 3600) return `약 ${Math.round(sec / 60)}분`;
  return `약 ${Math.round(sec / 3600)}시간`;
}
