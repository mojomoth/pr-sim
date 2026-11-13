import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sessionVocabulary } from "@/features/stt/vocab";
test("bench", () => {
  const seed = JSON.parse(readFileSync(process.cwd() + "/.verify/g3/p2/verify-2/visual/seed.json", "utf8"));
  const docs = [seed.session.docs.presentation, seed.session.docs.proposal];
  const chars = docs.reduce((a, d) => a + (d?.pageTexts ?? []).join("").length, 0);
  const t = performance.now(); const v = sessionVocabulary(docs); const ms = performance.now() - t;
  console.log(JSON.stringify({ chars, metrics: docs.map((d) => d?.keyNumbers?.length), wiki: docs.map((d) => d?.wiki?.length), n: v.length, ms: Math.round(ms), maxLen: Math.max(...v.map((w) => w.length)), sample: v.slice(0, 12) }));
});
