// Fix round 2: query/lint behaviour while LLM providers are down (or up). For each question checks HTTP 200,
// latency, and whether the expected figures are present in the CONTEXT (what judges/report consume).
// Run from pocs/: node wiki/tests/fix-r2-degraded.mjs
import { writeFileSync, mkdirSync } from "node:fs";
const B = "http://localhost:3100/api/wiki";
const PROP = "cb3e5a08f4107921", PRES = "b074e9bd3e49c31f", LARGE = "4fca1ca885eef124";
const Q = [
  [PROP, "2공장은 언제 가동하고 그때 목표 원가는 얼마인가?", ["3분기", "92원"]],
  [PROP, "국내 택배 연간 물량과 완충재 폐기물 규모는?", ["51억", "31만"]],
  [PROP, "지금까지 누적 출고량과 LOI 금액은?", ["158만", "24억"]],
  [PROP, "세트당 원가와 매출총이익률은?", ["142원"]],
  [PRES, "발표자료에서 SOM은 얼마이고 SAM의 몇 %인가?", ["340억", "5%"]],
  [LARGE, "세트당 원가는 얼마인가? 문서 안에서 값이 다르면 모두 알려줘", ["142원", "118원"]],
  [PROP, "현재 고객사 수와 재구매율은?", ["12곳", "83%"]],
];
const norm = (s) => s.replace(/[\s,]/g, "");
const rows = [];
for (const [doc, q, exp] of Q) {
  const t0 = Date.now();
  const r = await fetch(`${B}/docs/${doc}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `${q} `, answer: true }) });
  const j = await r.json();
  const ms = Date.now() - t0;
  const inCtx = exp.filter((e) => norm(j.context ?? "").includes(norm(e)));
  const row = { doc, q, status: r.status, ms, selector: j.selector, mode: j.mode, pages: j.pages, ctx: j.contextChars, pct: +((100 * j.contextChars) / j.fullTextChars).toFixed(1), inCtx: `${inCtx.length}/${exp.length}`, answer: !!j.answer, answerError: j.answerError ?? null };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const t1 = Date.now();
const lr = await fetch(`${B}/docs/${PROP}/lint`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const lj = await lr.json();
console.log(JSON.stringify({ lint: lr.status, ms: Date.now() - t1, issues: lj.issues?.length, llmError: lj.llmError ?? null }));
mkdirSync(".verify/wiki/fix-r2", { recursive: true });
writeFileSync(".verify/wiki/fix-r2/degraded-queries.json", JSON.stringify({ rows, lint: { status: lr.status, issues: lj.issues?.length, llmError: lj.llmError } }, null, 1));
