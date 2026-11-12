// Review round 3 (independent): grounding, tone, inconsistency coverage on saved runs (no LLM calls).
// usage: node question/tests/review-r3-runs.mjs <runId>...
import fs from "node:fs";
const BASE = "http://localhost:3100";
const norm = (s) => s.normalize("NFKC").replace(/[\s​]+/g, "").replace(/[“”"'‘’]/g, "").replace(/[.,]$/,"");
const cache = {};
async function page(id, n) { const k = `${id}/${n}`; if (!(k in cache)) { const r = await fetch(`${BASE}/api/wiki/docs/${id}/raw/${n}`); cache[k] = r.ok ? norm(await r.text()) : null; } return cache[k]; }
const out = [];
for (const id of process.argv.slice(2)) {
  const run = await (await fetch(`${BASE}/api/question/runs/${id}`)).json();
  const tr = norm(run.input.transcript.map((s) => s.text).join(" "));
  const ids = { presentation: run.input.presentationDocId, proposal: run.input.proposalDocId };
  let ok = 0, bad = [], verifiedFlagWrong = 0, total = 0;
  for (const q of run.questions.filter((q) => q.kind !== "followup")) for (const e of q.evidence) {
    total++;
    const quote = norm(e.quote).replace(/^…|…$/g, "").replace(/^\.\.\.|\.\.\.$/g, "");
    let found = false;
    if (e.doc === "transcript") found = tr.includes(quote);
    else { const p = e.correctedPage ?? e.page; const t = p ? await page(ids[e.doc], p) : null; found = !!t && t.includes(quote); }
    if (found) ok++; else bad.push(`${q.id} ${e.doc} p.${e.correctedPage ?? e.page} v=${e.verified}: ${e.quote.slice(0, 70)}`);
    if (!!e.verified !== found) verifiedFlagWrong++;
  }
  const byJ = {};
  for (const q of run.questions.filter((q) => q.kind !== "followup")) { const j = run.input.judges.find((x) => x.id === q.judgeId); (byJ[j.temperament] ??= []).push(`[d${q.difficulty}] ${q.question}`); }
  const allText = run.questions.map((q) => q.question + " " + q.targetClaim + " " + q.intent).join(" ");
  const incons = { unitCost: /118.*142|142.*118/.test(allText), som: /340.*210|210.*340/.test(allText) };
  out.push({ id, provider: run.usage?.[0] ? `${run.usage[0].provider}:${run.usage[0].model}` : null, total, ok, bad, verifiedFlagWrong, incons, byJ });
}
console.log(JSON.stringify(out, null, 1));
fs.mkdirSync(".verify/question/review/r3", { recursive: true });
fs.writeFileSync(".verify/question/review/r3/runs-check.json", JSON.stringify(out, null, 1));
