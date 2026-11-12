// Probe: are OpenAI / Claude usable right now? Run: node --env-file=.env.local wiki/scripts/probe-providers.mjs
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
const o = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
const c = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY, maxRetries: 0 });
let t=Date.now();
try { const r = await o.responses.create({ model: "gpt-5.4-nano", input: "say ok", reasoning:{effort:"none"} }); console.log("openai ok", r.output_text, Date.now()-t); } catch (e) { console.log("openai ERR", e.constructor.name, e.status, e.code, e.type, String(e.message).slice(0,120), Date.now()-t); }
t=Date.now();
try { await c.messages.create({ model: "claude-haiku-5-5", max_tokens: 20, messages:[{role:"user",content:"say ok"}] }); console.log("claude ok", Date.now()-t); } catch (e) { console.log("claude ERR", e.constructor.name, e.status, String(e.message).slice(0,160), Date.now()-t); }
