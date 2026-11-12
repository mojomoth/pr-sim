#!/usr/bin/env node
// Self-assessment of generated question samples:
//   1) grounding — every evidence quote re-checked independently against raw page text (/api/wiki/.../raw/N)
//      and the transcript (does NOT trust the server's `verified` flag)
//   2) intended weak points caught (fixtures/README.md: unit cost, SOM, growth/capacity, single supplier)
//   3) tone — lexical markers per temperament + a BLIND classification by a separate LLM (gpt-5.4-mini)
//   4) overlap — cross-judge similarity of questions within a run
// usage: node --env-file=.env.local question/tests/assess.mjs question/samples/tones-run1.json question/samples/tones-run2.json ...
import { readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const files = process.argv.slice(2);
const samples = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
const setup = await (await fetch(`${BASE}/api/question/setup`)).json();
const docIds = { presentation: setup.defaults.presentationDocId, proposal: setup.defaults.proposalDocId };
const transcript = setup.sample.transcript.map((s) => s.text).join(" ");

const norm = (s) => s.normalize("NFKC").replace(/[“”"]/g, '"').replace(/[‘’']/g, "'").replace(/\s+/g, "").replace(/[.,]$/, "");
const rawCache = new Map();
async function raw(doc, page) {
  const k = `${doc}:${page}`;
  if (!rawCache.has(k)) rawCache.set(k, fetch(`${BASE}/api/wiki/docs/${docIds[doc]}/raw/${page}`).then((r) => (r.ok ? r.text() : "")));
  return rawCache.get(k);
}
const pageCount = { presentation: 12, proposal: 58 };

const WEAK = [
  { id: "unit-cost", test: (q) => /118/.test(q) && /142/.test(q) || /(28\s*%|28퍼센트).*(14\s*%|14퍼센트)|(14\s*%|14퍼센트).*(28\s*%|28퍼센트)/.test(q) },
  { id: "som", test: (q) => /340/.test(q) && /210억/.test(q) || /SOM/.test(q) && /(3\.1|5\s*%)/.test(q) },
  { id: "growth-capacity", test: (q) => /32억/.test(q) && /(생산|공장|25만|능력|캐파|CAPA)/i.test(q) || /(월 신규 고객 8곳|8곳)/.test(q) && /(근거|전환|파이프라인|CAC)/.test(q) || /(12배|열두 배)/.test(q) },
  { id: "single-supplier", test: (q) => /(수협|공급처|원료).*(한 곳|1곳|단일|의존|대체)|(단일|한 곳).*(공급|수협)/.test(q) },
];

const PRAISE = /(인상적|좋았|좋습니다|흥미롭|잘 들었|감사|궁금합니다|듣고 싶|말씀해 주시겠|소개해 주시겠|설명해 주실 수)/;
const PRESSURE = /(아닙니까|않습니까|솔직히|정말|과연|무슨 근거|말이 안|부풀|설명이 안|되는 겁니까|어떻게 믿|왜 )/;
const DEMAND = /(수치로|근거|산식|계산|어느 쪽|정확히|구체적|기준)/;

const out = { at: new Date().toISOString(), files, grounding: { total: 0, ok: 0, failures: [] }, weakPoints: {}, tone: {}, blind: null, overlap: [] };
const all = [];
for (const s of samples) {
  for (const q of s.questions.filter((x) => x.kind !== "followup")) {
    const judge = s.judges.find((j) => j.id === q.judgeId);
    all.push({ run: s.tag, temperament: judge.temperament, ...q });
    for (const e of q.evidence) {
      out.grounding.total++;
      const nq = norm(e.quote).replace(/^…|…$/g, "");
      let ok = false;
      let where = null;
      if (e.doc === "transcript") ok = norm(transcript).includes(nq);
      else {
        const page = e.correctedPage ?? e.page;
        if (page && norm(await raw(e.doc, page)).includes(nq)) ok = true;
        if (!ok)
          for (let p = 1; p <= pageCount[e.doc]; p++)
            if (norm(await raw(e.doc, p)).includes(nq)) {
              ok = true;
              where = p;
              break;
            }
      }
      if (ok) out.grounding.ok++;
      else out.grounding.failures.push({ run: s.tag, q: q.id, doc: e.doc, page: e.page, quote: e.quote });
      if (where) out.grounding.failures.push({ note: "found on other page", run: s.tag, q: q.id, claimed: e.page, actual: where });
    }
  }
}
for (const w of WEAK) out.weakPoints[w.id] = all.filter((q) => w.test(q.question + " " + q.targetClaim)).map((q) => `${q.run}/${q.id}`);

for (const t of ["friendly", "strict", "aggressive"]) {
  const qs = all.filter((q) => q.temperament === t);
  const avg = (f) => +(qs.reduce((s, q) => s + f(q), 0) / Math.max(qs.length, 1)).toFixed(2);
  out.tone[t] = {
    n: qs.length,
    avgDifficulty: avg((q) => q.difficulty),
    avgChars: avg((q) => q.question.length),
    praiseRate: avg((q) => (PRAISE.test(q.question) ? 1 : 0)),
    pressureRate: avg((q) => (PRESSURE.test(q.question) ? 1 : 0)),
    demandRate: avg((q) => (DEMAND.test(q.question) ? 1 : 0)),
    examples: qs.slice(0, 4).map((q) => q.question),
  };
}

// blind classification
const shuffled = all.map((q, i) => ({ i, q: q.question, t: q.temperament })).sort(() => Math.random() - 0.5);
const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const r = await oa.responses.create({
  model: "gpt-5.4-mini",
  reasoning: { effort: "low" },
  input: [
    { role: "system", content: "투자 심사위원의 질문 문장만 보고 그 심사위원의 성향을 분류하세요. friendly=격려·설명 요청·부드러움, strict=건조하게 수치·근거·정합성 요구, aggressive=가정에 도전·모순 압박·단호. JSON만." },
    { role: "user", content: shuffled.map((x, k) => `${k + 1}. ${x.q}`).join("\n") },
  ],
  text: { format: { type: "json_schema", name: "cls", strict: true, schema: { type: "object", additionalProperties: false, required: ["labels"], properties: { labels: { type: "array", items: { type: "string", enum: ["friendly", "strict", "aggressive"] } } } } } },
});
const labels = JSON.parse(r.output_text).labels;
const confusion = {};
let correct = 0;
shuffled.forEach((x, k) => {
  const pred = labels[k];
  confusion[`${x.t}→${pred}`] = (confusion[`${x.t}→${pred}`] ?? 0) + 1;
  if (pred === x.t) correct++;
});
out.blind = { model: "gpt-5.4-mini", n: shuffled.length, accuracy: +(correct / shuffled.length).toFixed(3), confusion };

// overlap within a run (main questions across judges)
const sim = (a, b) => {
  const bg = (s) => new Set([...s.replace(/\s/g, "")].map((c, i, arr) => c + (arr[i + 1] ?? "")).slice(0, -1));
  const A = bg(a), B = bg(b);
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size || 1);
};
for (const s of samples) {
  const qs = s.questions.filter((q) => q.kind !== "followup");
  let max = 0, pair = null;
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) if (qs[i].judgeId !== qs[j].judgeId) {
    const v = sim(qs[i].question, qs[j].question);
    if (v > max) { max = v; pair = [qs[i].question, qs[j].question]; }
  }
  const targets = qs.filter((q) => q.targetId).map((q) => q.targetId);
  out.overlap.push({ run: s.tag, maxCrossJudgeSimilarity: +max.toFixed(2), pair, duplicateTargetIds: targets.filter((t, i) => targets.indexOf(t) !== i), main: s.main });
}

writeFileSync("question/samples/assessment.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ grounding: { total: out.grounding.total, ok: out.grounding.ok, failures: out.grounding.failures.length }, weakPoints: Object.fromEntries(Object.entries(out.weakPoints).map(([k, v]) => [k, v.length])), tone: Object.fromEntries(Object.entries(out.tone).map(([k, v]) => [k, { d: v.avgDifficulty, praise: v.praiseRate, pressure: v.pressureRate, demand: v.demandRate, chars: v.avgChars }])), blind: out.blind, overlap: out.overlap.map((o) => [o.run, o.maxCrossJudgeSimilarity, o.duplicateTargetIds]) }, null, 1));
