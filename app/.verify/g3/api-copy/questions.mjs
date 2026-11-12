// Live /api/questions with 3 friendly judges: count cliché openers ("인상적", "흥미롭", "좋은 발표") in the generated questions.
import { readFileSync, writeFileSync } from "node:fs";
import { buildSession } from "../../g2/SCREENS-C/seed.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/api-copy";
const s = buildSession("q");
const wikiOf = (role) => readFileSync(`/Users/jyl/work/study/pr-sim/app/.verify/g2/api/wiki-${role}.ndjson`, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((l) => l.type === "done");
const docs = ["presentation", "proposal"].map((role) => { const d = s.docs[role]; const w = wikiOf(role); return { role, docId: d.docId, filename: d.filename, pageTexts: d.pageTexts, wiki: w.wiki, keyNumbers: w.keyNumbers }; });
const judges = [
  { id: "f1", name: "정민", temperament: "friendly", gender: "female", age: 48 },
  { id: "f2", name: "서연", temperament: "friendly", gender: "female", age: 35 },
  { id: "f3", name: "도윤", temperament: "friendly", gender: "male", age: 52 },
];
const body = { situation: s.setup.situation, qaMinutes: 6, presentationMinutes: s.setup.presentationMinutes, transcript: s.transcript.filter((t) => t.phase === "presentation"), docs, judges };
const t0 = Date.now();
const r = await fetch("http://localhost:3000/api/questions", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(body) });
const text = await r.text();
writeFileSync(`${OUT}/questions-friendly.ndjson`, text);
const lines = text.trim().split("\n").map((l) => JSON.parse(l));
const qs = lines.filter((l) => l.type === "question").map((l) => l.question?.text ?? l.question?.question ?? JSON.stringify(l.question).slice(0, 200));
const cliche = qs.filter((q) => /인상적|흥미롭|좋은 발표/.test(q));
const res = { status: r.status, ms: Date.now() - t0, count: qs.length, cliche: cliche.length, last: lines.at(-1).type, error: lines.find((l) => l.type === "error"), questions: qs };
writeFileSync(`${OUT}/questions-friendly.summary.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
