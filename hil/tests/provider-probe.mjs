// Minimal 1-call-per-provider probe (tiny prompts) to report which LLM providers are usable right now.
// Run from pocs/: node --env-file=.env.local hil/tests/provider-probe.mjs  — never prints keys.
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
const out = {};
async function probe(name, fn) {
  const t = Date.now();
  try { const r = await fn(); out[name] = { ok: true, ms: Date.now() - t, sample: String(r).slice(0, 40) }; }
  catch (e) { out[name] = { ok: false, ms: Date.now() - t, status: e?.status ?? null, error: String(e?.message ?? e).replace(/(sk-|AIza)[\w-]+/g, "***").slice(0, 160) }; }
}
await Promise.all([
  probe("openai:gpt-5.4-nano", async () => (await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses.create({ model: "gpt-5.4-nano", input: "Say OK" })).output_text),
  probe("claude:claude-haiku-5-5", async () => (await new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }).messages.create({ model: "claude-haiku-5-5", max_tokens: 16, messages: [{ role: "user", content: "Say OK" }] })).content[0]?.text),
  probe("gemini:gemini-3.5-flash-lite", async () => (await new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY }).models.generateContent({ model: "gemini-3.5-flash-lite", contents: "Say OK" })).text),
]);
console.log(JSON.stringify({ at: new Date().toISOString(), ...out }, null, 1));
