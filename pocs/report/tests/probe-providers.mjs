// Probe each LLM provider with a tiny call (no keys printed). Run: node --env-file=.env.local report/tests/probe-providers.mjs
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
const out = {};
const t = async (name, fn) => {
  const s = Date.now();
  try { out[name] = { ok: true, text: String(await fn()).slice(0, 60), ms: Date.now() - s }; }
  catch (e) { out[name] = { ok: false, status: e.status, err: String(e.message).slice(0, 160), ms: Date.now() - s }; }
};
await Promise.all([
  t("claude-opus-5-5", async () => (await new Anthropic({ apiKey: process.env.CLAUDE_API_KEY, maxRetries: 0 }).messages.create({ model: "claude-opus-5-5", max_tokens: 16, messages: [{ role: "user", content: "ping" }] })).content[0].text),
  t("claude-sonnet-5-5", async () => (await new Anthropic({ apiKey: process.env.CLAUDE_API_KEY, maxRetries: 0 }).messages.create({ model: "claude-sonnet-5-5", max_tokens: 16, messages: [{ role: "user", content: "ping" }] })).content[0].text),
  t("gpt-5.5", async () => (await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 }).responses.create({ model: "gpt-5.5", input: "ping", max_output_tokens: 32 })).output_text),
  t("gemini-3.8-flash", async () => (await new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY }).models.generateContent({ model: "gemini-3.8-flash", contents: "ping" })).text),
]);
console.log(JSON.stringify(out, null, 1));
