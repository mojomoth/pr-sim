import "server-only";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// Shared server-only AI clients. Keys come from the root .env (symlinked as app/.env.local).
// Model choice: docs/dev-v1/report.md D1–D10 (OpenAI first, Claude only as the last fallback until 2026-12-01).
export const MODELS = {
  geminiTranscribeLive: "gemini-3.5-transcribe-live",
  geminiTts: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"],
  openaiTts: "gpt-4o-mini-tts",
  openaiImage: "gpt-image-2",
  claudeSmart: "claude-opus-5-5",
  claudeFast: "claude-sonnet-5-5",
  claudeCheap: "claude-haiku-5-5",
} as const;

/** Last-resort text models (Gemini free tier) at the end of every text chain. Answers from these are lower quality:
 *  routes report them as `degraded` so the UI can say so. */
export const LITE_FALLBACK = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;
export const isLiteFallback = (model: string) => (LITE_FALLBACK as readonly string[]).includes(model);

/** OpenAI's SDK retries every 429 — including "no credits" (insufficient_quota / credit_balance_exhausted), which never
 *  recovers. Mark those responses as non-retryable so the call fails in ~1 s instead of ~20 s. */
export const quotaAwareFetch: typeof fetch = async (input, init) => {
  const r = await fetch(input, init);
  if (r.status !== 429) return r;
  const text = await r.clone().text();
  if (!/insufficient_quota|credit_balance|no credits|billing/i.test(text)) return r;
  const headers = new Headers(r.headers);
  headers.set("x-should-retry", "false");
  return new Response(text, { status: r.status, statusText: r.statusText, headers });
};

let _gemini: GoogleGenAI | undefined;
let _openai: OpenAI | undefined;
let _claude: Anthropic | undefined;

export function gemini() {
  if (!process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY missing");
  return (_gemini ??= new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY }));
}
export function openai() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  return (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}
export function claude() {
  if (!process.env.CLAUDE_API_KEY) throw new Error("CLAUDE_API_KEY missing");
  return (_claude ??= new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }));
}
