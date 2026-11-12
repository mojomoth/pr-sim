// Fake "@/lib/ai" for wiki tests: an OpenAI-shaped client whose responses are driven by globalThis.__mockAi.
//   mode "ok":          chunk_notes → one mock topic per chunk (after `delayMs`), every other call fails fast
//                       (the pipeline's deterministic fallbacks build plan/pages/overview/주요-수치)
//   mode "fail":        chunk_notes fails (after `delayMs`) → the whole build fails
//   mode "unavailable": every call fails with OpenAI 429 insufficient_quota (trips the breaker like the real outage)
import OpenAI from "openai";

export const MODELS = { claudeSmart: "mock-smart", claudeFast: "mock-fast", claudeCheap: "mock-cheap" };
const st = (globalThis.__mockAi ??= { mode: "ok", delayMs: 0, calls: [] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortErr = () => Object.assign(new Error("mock: no answer"), { name: "AbortError" });

const client = {
  withOptions() {
    return client;
  },
  responses: {
    async create(req) {
      const name = req.text?.format?.name;
      st.calls.push(name);
      if (st.mode === "unavailable") throw new OpenAI.RateLimitError(429, { code: "insufficient_quota", type: "insufficient_quota", message: "You exceeded your current quota" }, "429 insufficient_quota", new Headers());
      if (name === "probe") return out({ ok: true });
      if (name !== "chunk_notes") throw abortErr(); // non-retryable → fallbacks
      await sleep(st.delayMs);
      if (st.mode === "fail") throw abortErr();
      const n = st.calls.filter((c) => c === "chunk_notes").length;
      return out({ summary: `모의 요약 ${n}`, topics: [{ slug: `모의-주제-${n}`, title: `모의 주제 ${n}`, type: "topic", facts: [{ claim: `모의 사실 ${n}`, pages: [] }] }], numbers: [] });
    },
  },
};
const out = (o) => ({ status: "completed", output_text: JSON.stringify(o), usage: { input_tokens: 1, output_tokens: 1 } });

export const openai = () => client;
export const claude = () => {
  throw new Error("mock: claude disabled (WIKI_LLM_PROVIDER=openai)");
};
export const gemini = claude;
