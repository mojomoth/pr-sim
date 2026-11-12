// Probe: what an SDK call aborted by AbortSignal.timeout looks like (used by query.ts isTimeout / llm.ts isRetryable).
// Run: node --env-file=.env.local wiki/scripts/probe-abort.mjs
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
const o = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const c = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
for (const [name, fn] of [
  ["openai", (signal) => o.responses.create({ model: "gpt-5.4-nano", input: "ok" }, { signal })],
  ["claude", (signal) => c.messages.stream({ model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "ok" }] }, { signal }).finalMessage()],
]) {
  const t = Date.now();
  try { await fn(AbortSignal.timeout(30)); console.log(name, "no error"); } catch (e) { console.log(name, e.constructor.name, "name=" + e.name, JSON.stringify(e.message).slice(0, 80), Date.now() - t, "ms"); }
}
