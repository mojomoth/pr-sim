// Query accuracy & citation check against the immutable raw text.
// node wiki/tests/queries.mjs <proposalDocId> <presentationDocId> [largeDocId]
// For each case: expected values must appear in the answer AND in at least one cited raw page.
// Also numeric-citation precision: every number in an answer sentence must occur in that sentence's cited pages.
import { writeFileSync } from "node:fs";
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const [prop, pres, large] = process.argv.slice(2);
const CASES = [
  { doc: prop, q: "세트당 원가와 매출총이익률은 얼마인가?", expect: ["142원", "14%"] },
  { doc: prop, q: "SOM(획득 가능 시장)은 얼마이고 SAM 대비 몇 %인가?", expect: ["210억", "3.1%"] },
  { doc: prop, q: "2027년 매출 목표와 1공장 생산능력은?", expect: ["32억", "25만"] },
  { doc: prop, q: "원료는 어디서 조달하고 공급 리스크는 어떻게 평가했나?", expect: ["수협", "낮"] },
  { doc: prop, q: "투자 요청 금액과 자금 사용 계획은?", expect: ["20억"] },
  { doc: prop, q: "고객 재구매율과 현재 고객 수는?", expect: ["83%", "12"] },
  { doc: prop, q: "판매가는 세트당 얼마인가?", expect: ["165원"] },
  { doc: pres, q: "세트당 원가와 매출총이익률은 얼마인가?", expect: ["118원", "28%"] },
  { doc: pres, q: "SOM은 얼마인가?", expect: ["340억"] },
  ...(large ? [{ doc: large, q: "세트당 원가는 얼마인가? 문서 안에서 값이 다르게 나오나?", expect: ["142원", "118원"] }] : []),
];
const norm = (s) => s.replace(/\s+/g, "").replace(/,/g, "");
const rawCache = new Map();
async function raw(doc, p) {
  const k = doc + p;
  if (!rawCache.has(k)) rawCache.set(k, await (await fetch(`${BASE}/api/wiki/docs/${doc}/raw/${p}`)).text());
  return rawCache.get(k);
}
const CITE = /\(\s*p{1,2}\.\s*\d+(?:\s*[–\-~,]\s*(?:p{1,2}\.\s*)?\d+)*\s*\)/g;
function pagesOf(g) {
  const out = [];
  for (const part of g.replace(/[()]/g, "").replace(/p{1,2}\.\s*/g, "").split(",")) {
    const r = part.split(/[–\-~]/).map((x) => Number(x.trim()));
    if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 30) for (let p = r[0]; p <= r[1]; p++) out.push(p);
    else if (Number.isFinite(r[0])) out.push(r[0]);
  }
  return out;
}
const NUM = /\d[\d,.]*\s*(?:%|원|억|만|조|곳|개|명|세트|톤|배)/g;
const rows = [];
let pass = 0, numOk = 0, numAll = 0;
for (const c of CASES) {
  const t0 = Date.now();
  const r = await (await fetch(`${BASE}/api/wiki/docs/${c.doc}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: c.q, answer: true, maxContextChars: 6000, selector: process.env.SELECTOR ?? "llm" }) })).json();
  if (r.error) { console.log("ERR", c.q, r.error); continue; }
  const ms = Date.now() - t0;
  const ans = r.answer ?? "";
  const cited = r.citations;
  const checks = [];
  for (const e of c.expect) {
    const inAnswer = norm(ans).includes(norm(e));
    let inRaw = false;
    for (const p of cited) if (norm(await raw(c.doc, p)).includes(norm(e))) { inRaw = true; break; }
    checks.push({ e, inAnswer, inRaw });
  }
  // numeric citation precision per sentence
  // segment = text since the previous citation group, up to and including this one
  let prev = 0;
  const segs = [];
  for (const m of ans.matchAll(CITE)) {
    segs.push({ text: ans.slice(prev, m.index), ps: pagesOf(m[0]) });
    prev = m.index + m[0].length;
  }
  for (const { text: segText, ps } of segs) {
    const text = segText.replace(CITE, "");
    for (const n of text.match(NUM) ?? []) {
      numAll++;
      const nn = norm(n).replace(/(\d)\.0(?=\D)/, "$1");
      let ok = false;
      for (const p of ps) if (norm(await raw(c.doc, p)).includes(nn)) { ok = true; break; }
      if (ok) numOk++;
      else console.log("   ✗ number not in cited pages:", n, "cited", ps.join(","));
    }
  }
  const ok = checks.every((x) => x.inAnswer && x.inRaw);
  if (ok) pass++;
  rows.push({ q: c.q, doc: c.doc, ok, checks, selected: r.selected, pages: r.pages, selector: r.selector, contextChars: r.contextChars, fullTextChars: r.fullTextChars, citations: cited, selectMs: r.timings.selectMs, answerMs: r.timings.answerMs, totalMs: ms, answer: ans });
  console.log(`${ok ? "PASS" : "FAIL"} [${r.selector} ${r.timings.selectMs}ms + ans ${r.timings.answerMs}ms = ${ms}ms] ${c.q}`);
  console.log(`   pages: ${r.pages.join(", ")} | ctx ${r.contextChars}/${r.fullTextChars} chars (${((100 * r.contextChars) / r.fullTextChars).toFixed(1)}%) | cites p.${cited.join(",")}`);
  console.log(`   checks: ${checks.map((x) => `${x.e}:${x.inAnswer ? "A" : "-"}${x.inRaw ? "R" : "-"}`).join(" ")}`);
  console.log("   " + ans.replace(/\n/g, " ").slice(0, 400));
}
console.log(`\n${pass}/${rows.length} cases pass · numeric citation precision ${numOk}/${numAll}`);
writeFileSync(`.verify/wiki/queries-${process.env.SELECTOR ?? "llm"}.json`, JSON.stringify({ pass, total: rows.length, numOk, numAll, rows }, null, 1));
