import "server-only";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// Shared server-only AI clients. Keys come from ../.env (symlinked as .env.local).
// Model ids verified available on 2026-11-12 against each provider's /models endpoint.
export const MODELS = {
  // Gemini
  geminiTranscribe: "gemini-3.5-transcribe", // STT (generateContent)
  geminiTranscribeLive: "gemini-3.5-transcribe-live", // STT streaming (bidiGenerateContent)
  geminiTts: "gemini-3.8-flash-tts", // TTS
  geminiFlash: "gemini-3.8-flash",
  // OpenAI
  openaiImage: "gpt-image-2",
  // Anthropic
  claudeSmart: "claude-opus-5-5",
  claudeFast: "claude-sonnet-5-5",
  claudeCheap: "claude-haiku-5-5",
} as const;

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
