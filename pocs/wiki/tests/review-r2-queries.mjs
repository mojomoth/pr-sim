// Reviewer round 2: independent query checks (different questions from builder's set).
import { writeFileSync } from "node:fs";
const B = "http://localhost:3100/api/wiki";
const PROP = "cb3e5a08f4107921", PRES = "b074e9bd3e49c31f", LARGE = "4fca1ca885eef124";
const Q = [
  [PROP, "2공장은 언제 가동하고 그때 목표 원가는 얼마인가?", ["3분기", "92원"]],
  [PROP, "국내 택배 연간 물량과 완충재 폐기물 규모는?", ["51억", "31만"]],
  [PROP, "지금까지 누적 출고량과 LOI 금액은?", ["158만", "24억"]],
  [PROP, "세트당 원가 중 에너지 비용과 인건비는 각각 얼마인가?", ["31원", "38원"]],
  [PRES, "발표자료에서 SOM은 얼마이고 SAM의 몇 %인가?", ["340억", "5%"]],
  [LARGE, "세트당 원가는 얼마인가? 문서 안에서 값이 다르면 모두 알려줘", ["142원", "118원"]],
  [PROP, "회사가 보유한 미국 특허는 몇 건인가?", []],
  [PROP, "현재 고객사 수와 재구매율은?", ["12곳", "83%"]],
];
const raw = new Map();
async function rawPage(doc, p) { const k = doc + p; if (!raw.has(k)) raw.set(k, await (await fetch(`${B}/docs/${doc}/raw/${p}`)).text()); return raw.get(k); }
const norm = (s) => s.replace(/[\s,]/g, "");
const out = [];
for (const [doc, q, exp] of Q) {
  const t0 = Date.now();
  const r = await fetch(`${B}/docs/${doc}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q, answer: true }) });
  const j = await r.json();
  const ms = Date.now() - t0;
  const ans = j.answer ?? "";
  const res = { doc, q, status: r.status, ms, pages: j.pages, ctx: j.contextChars, full: j.fullTextChars, pct: +(100 * j.contextChars / j.fullTextChars).toFixed(1), mode: j.mode, citations: j.citations, checks: [] };
  for (const e of exp) {
    const inAns = norm(ans).includes(norm(e));
    let citedHas = [];
    for (const p of j.citations ?? []) if (norm(await rawPage(doc, p)).includes(norm(e))) citedHas.push(p);
    res.checks.push({ e, inAns, citedHas });
  }
  // invalid citations: cited pages > pageCount or pages with none of the expected tokens
  res.answer = ans;
  out.push(res);
  console.log(`[${r.status}] ${ms}ms ${q}\n  pages=${j.pages} ctx=${j.contextChars}/${j.fullTextChars} (${res.pct}%) mode=${j.mode} cites=${j.citations}\n  checks=${JSON.stringify(res.checks)}\n  A: ${ans.replace(/\n/g, " ").slice(0, 600)}\n`);
}
writeFileSync(".verify/wiki/review/r2-queries.json", JSON.stringify(out, null, 1));
