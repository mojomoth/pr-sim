// Probe: latency of OpenAI models for wiki tiers (structured JSON). Run: node --env-file=.env.local wiki/scripts/probe-llm.mjs
import OpenAI from "openai";
import { extractText } from "unpdf";
import { readFileSync } from "node:fs";
const o = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { text } = await extractText(new Uint8Array(readFileSync("fixtures/proposal.pdf")));
const chunk = text.slice(33, 41).map((t, i) => `=== p.${34 + i} ===\n${t}`).join("\n");
console.log("chunk chars", chunk.length, "pages", text.length, "total chars", text.join("").length);
const schema = { type: "object", additionalProperties: false, required: ["topics"], properties: { topics: { type: "array", items: { type: "object", additionalProperties: false, required: ["slug", "facts"], properties: { slug: { type: "string" }, facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "pages"], properties: { claim: { type: "string" }, pages: { type: "array", items: { type: "integer" } } } } } } } } } };
for (const [model, effort] of [["gpt-5.4-nano", "low"], ["gpt-5.4-mini", "low"], ["gpt-5.4-mini", "none"], ["gpt-5.5", "low"]]) {
  const t0 = Date.now();
  try {
    const r = await o.responses.create({ model, reasoning: { effort }, input: [{ role: "system", content: "Extract wiki topics with facts and page citations from the Korean business plan chunk. Korean output." }, { role: "user", content: chunk }], text: { format: { type: "json_schema", name: "x", schema, strict: true } } });
    const j = JSON.parse(r.output_text);
    console.log(model, effort, Date.now() - t0, "ms", r.usage.input_tokens, r.usage.output_tokens, "topics", j.topics.length, "facts", j.topics.reduce((a, t) => a + t.facts.length, 0));
  } catch (e) { console.log(model, effort, "ERR", e.status, String(e.message).slice(0, 150)); }
}
