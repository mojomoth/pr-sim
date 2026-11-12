#!/usr/bin/env node
// Answer → follow-up loop with a WEAK and a STRONG answer (real provider calls). Also checks the TTS route.
// usage: node question/tests/followup.mjs <samples/x.json>   (a sample written by generate.mjs)
import { readFileSync, writeFileSync } from "node:fs";
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const sample = JSON.parse(readFileSync(process.argv[2] ?? "question/samples/smoke.json", "utf8"));
const qs = sample.questions;
const find = (re, temp) => qs.find((q) => re.test(q.question) && (!temp || q.judgeId.includes(temp))) ?? qs.find((q) => q.judgeId.includes(temp ?? ""));

const costQ = find(/118|142|원가|마진|이익률/, "aggressive");
const somQ = find(/SOM|340|210|시장/, "strict") ?? find(/./, "strict");
const WEAK = "아 그게… 기준이 좀 달라서요. 아마 초기 수치가 반영된 것 같고, 어쨌든 앞으로 원가는 계속 내려갈 겁니다.";
const STRONG_COST =
  "정정드리겠습니다. 현재 양산 원가는 제안서의 142원이 맞습니다. 원료 18원, 전분 22원, 에너지 31원, 인건비 38원, 물류 19원, 감가상각 14원으로 구성되고, 매출총이익률은 약 14%입니다. 발표자료의 118원은 에너지와 인건비 효율화를 반영한 내부 목표치를 잘못 기재한 것입니다. 2027년 3분기 2공장 가동 후 자동화로 2028년 92원까지 낮추는 것이 계획입니다.";
const STRONG_SOM =
  "SOM은 제안서의 210억 원, SAM 6,800억 원의 약 3.1%가 최신 기준입니다. 발표자료의 5%, 340억 원은 초기 버전 수치로, 고객 확보 속도와 생산능력을 반영해 보수적으로 낮췄습니다. 덱도 210억 원으로 바로 수정하겠습니다.";

let attemptId; // one Q&A session for the whole script (server creates it on the first call)
async function follow(q, answer, label, extra = {}) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/question/followup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: sample.runId, judgeId: q.judgeId, questionId: q.id, answer, remainingSec: 150, ...(attemptId ? { attemptId } : {}), ...extra }),
  });
  const j = await r.json();
  attemptId ??= j.attemptId;
  const ms = Date.now() - t0;
  console.log(`\n[${label}] ${r.status} ${ms}ms  Q(${q.id}): ${q.question}\n  A: ${answer.slice(0, 80)}…\n  → ${j.decision} | ${j.assessment?.verdict} ${j.assessment?.score}/5 — ${j.assessment?.reason}\n  remark: ${j.remark}${j.followup ? `\n  follow-up: ${j.followup.question}\n  ev: ${j.followup.evidence.map((e) => `${e.verified ? "✓" : "✗"}${e.doc}${e.page ? "p" + e.page : ""}`).join(" ")}` : ""}${j.error ? `\n  ERROR ${j.error}` : ""}`);
  return { label, status: r.status, ms, questionId: q.id, question: q.question, answer, result: j };
}

const results = [];
results.push(await follow(costQ, WEAK, "weak-answer"));
const fu = results[0].result.followup;
if (fu) results.push(await follow(fu, STRONG_COST, "strong-answer-to-followup"));
results.push(await follow(somQ, STRONG_SOM, "strong-answer"));
results.push(await follow(somQ, "음… 잘 모르겠습니다.", "low-time-forced-next", { remainingSec: 20 }));

// TTS for one question in each judge's voice (cached on disk by stt-tts)
const tts = [];
for (const q of [costQ, somQ]) {
  const judge = sample.judges.find((j) => j.id === q.judgeId);
  const setup = await (await fetch(`${BASE}/api/question/setup`)).json();
  const base = setup.sample.judges.find((j) => j.temperament === judge.temperament);
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/question/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: q.question, gender: base.gender, age: base.age, temperament: base.temperament }) });
  const buf = Buffer.from(await r.arrayBuffer());
  const info = { status: r.status, ms: Date.now() - t0, bytes: buf.length, type: r.headers.get("content-type"), voice: r.headers.get("x-voice"), model: r.headers.get("x-model"), cache: r.headers.get("x-cache"), duration: r.headers.get("x-duration"), riff: buf.subarray(0, 4).toString() };
  if (r.status !== 200) info.error = buf.toString().slice(0, 300);
  console.log(`\n[tts] ${q.id}`, info);
  tts.push({ questionId: q.id, ...info });
}

const run = await (await fetch(`${BASE}/api/question/runs/${sample.runId}?attempt=${attemptId}`)).json();
writeFileSync(sample.tag ? `question/samples/${sample.tag}-followup.json` : "question/samples/followup.json", JSON.stringify({ at: new Date().toISOString(), runId: sample.runId, attemptId, results, tts, qaLog: run.attempt?.qa ?? [] }, null, 2));
console.log(`\nqa log entries (attempt ${attemptId}): ${run.attempt?.qa.length ?? 0}`);
