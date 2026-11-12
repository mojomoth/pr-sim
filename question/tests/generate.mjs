#!/usr/bin/env node
// Real-provider generation run through the API (NDJSON stream), saved to question/samples/.
// usage: node question/tests/generate.mjs [tag] [--judges friendly,strict,aggressive] [--fast] [--count N] [--avoid samples/x.json] [--proposal <docId>] [--quiet]
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? undefined : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
};
const tag = args[0] && !args[0].startsWith("--") ? args[0] : `run-${Date.now()}`;
const quiet = !!flag("quiet");

const setup = await (await fetch(`${BASE}/api/question/setup`)).json();
const temps = String(flag("judges") ?? "friendly,strict,aggressive").split(",");
const pool = setup.sample.judges;
const judges = temps.map((t, i) => {
  const base = pool.find((j) => j.temperament === t) ?? pool[i % pool.length];
  return { ...base, id: `${base.id}-${i}`, temperament: t };
});
const body = {
  situation: setup.sample.situation,
  qaMinutes: setup.sample.qaMinutes,
  presentationMinutes: setup.sample.presentationMinutes,
  transcript: setup.sample.transcript,
  presentationDocId: setup.defaults.presentationDocId,
  proposalDocId: typeof flag("proposal") === "string" ? flag("proposal") : setup.defaults.proposalDocId,
  judges,
  fastContext: !!flag("fast"),
  ...(flag("count") ? { questionCount: Number(flag("count")) } : {}),
  ...(flag("avoid") ? { avoidQuestions: JSON.parse((await import("node:fs")).readFileSync(flag("avoid"), "utf8")).questions.filter((q) => q.kind !== "followup").map((q) => q.question) } : {}),
};
const t0 = Date.now();
const res = await fetch(`${BASE}/api/question/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
if (!res.ok) {
  console.error(res.status, await res.text());
  process.exit(1);
}
const events = [];
let firstDelta, firstQuestion;
const dec = new TextDecoder();
let buf = "";
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    e._t = Date.now() - t0;
    if (e.type === "delta") {
      firstDelta ??= e._t;
      continue;
    }
    if (e.type === "question") firstQuestion ??= e._t;
    events.push(e);
    if (!quiet) {
      if (e.type === "stage") console.log(`[${e._t}ms] ${e.stage}: ${e.msg}`);
      else if (e.type === "context") console.log(`[${e._t}ms] context ${e.pack.chars} chars, ${e.pack.queries.length} queries, raw pages ${e.pack.rawPages.map((r) => r.doc[0] + r.page).join(",")}, targets ${e.pack.targets.length}, lint ${JSON.stringify(e.pack.lint)}`);
      else if (e.type === "plan") console.log(`[${e._t}ms] plan ${JSON.stringify(e.assignments)} provider=${e.provider}`);
      else if (e.type === "question") console.log(`[${e._t}ms] Q ${e.question.id} (d${e.question.difficulty}, ${e.question.targetId}) ${e.question.question}\n     ev: ${e.question.evidence.map((x) => `${x.verified ? "✓" : "✗"}${x.doc}${x.page ? "p" + x.page : ""}${x.correctedPage ? "→p" + x.correctedPage : ""} "${x.quote.slice(0, 40)}"`).join(" | ")}`);
      else if (e.type === "judge-done") console.log(`[${e._t}ms] judge-done ${e.judgeId} ${JSON.stringify(e.usage)}`);
      else if (e.type === "error") console.log(`[${e._t}ms] ERROR ${e.message}`);
      else if (e.type === "done") console.log(`[${e._t}ms] done main=${e.main.join(",")} reserve=${e.reserve.join(",")} timings=${JSON.stringify(e.timings)}`);
    }
  }
}
const done = events.find((e) => e.type === "done");
const run = done ? await (await fetch(`${BASE}/api/question/runs/${done.runId}`)).json() : null;
mkdirSync("question/samples", { recursive: true });
const out = {
  tag,
  at: new Date().toISOString(),
  totalMs: Date.now() - t0,
  firstDeltaMs: firstDelta,
  firstQuestionMs: firstQuestion,
  runId: done?.runId,
  judges: judges.map((j) => ({ id: j.id, name: j.name, temperament: j.temperament })),
  provider: events.find((e) => e.type === "plan")?.provider,
  timings: done?.timings,
  usage: done?.usage,
  context: run ? { id: run.pack.id, chars: run.pack.chars, approxTokens: run.pack.approxTokens, sections: run.pack.sections, targets: run.pack.targets, rawPages: run.pack.rawPages, queries: run.pack.queries.length, lint: run.pack.lint } : null,
  main: done?.main,
  reserve: done?.reserve,
  questions: run?.questions ?? [],
  errors: events.filter((e) => e.type === "error"),
};
writeFileSync(`question/samples/${tag}.json`, JSON.stringify(out, null, 2));
console.log(`saved question/samples/${tag}.json total ${out.totalMs}ms firstDelta ${firstDelta}ms firstQuestion ${firstQuestion}ms`);
