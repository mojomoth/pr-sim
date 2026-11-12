#!/usr/bin/env node
// Q&A sessions are isolated (review round 2): real provider calls against a run that ALREADY holds QA history
// from older sessions. Checks: fresh session → evasive answer gets a follow-up (cap not pre-used), the follow-up
// count resets per session, the run file is never modified, judge ownership is enforced, sessions save per attempt.
// usage: node question/tests/attempts.mjs [runId]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const runId = process.argv[2] ?? "r_mwdn00iwkin6b";
const runFile = `.data/question/runs/${runId}.json`;
const md5 = () => createHash("md5").update(readFileSync(runFile)).digest("hex");
const run0 = JSON.parse(readFileSync(runFile, "utf8"));
const before = md5();
const strictQ = run0.questions.find((q) => q.kind !== "followup" && q.judgeId.includes("strict"));
const otherJudge = run0.input.judges.find((j) => j.id !== strictQ.judgeId);
const out = { at: new Date().toISOString(), runId, legacyQaInRun: run0.qa.length, legacyFollowupsInRun: run0.questions.filter((q) => q.kind === "followup").length, steps: [] };
let fail = 0;
const check = (c, msg) => {
  console.log(`${c ? "PASS" : "FAIL"} ${msg}`);
  out.steps.push({ pass: !!c, msg });
  if (!c) fail++;
};
async function post(path, body) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, ms: Date.now() - t0, json: await r.json() };
}
const fu = (body) => post("/api/question/followup", { runId, remainingSec: 170, ...body });
const show = (label, r) => {
  const j = r.json;
  console.log(`  [${label}] ${r.status} ${r.ms}ms ${j.decision ?? ""} ${j.assessment ? `${j.assessment.verdict} ${j.assessment.score}/5` : ""} remark="${j.remark ?? ""}"(${(j.remark ?? "").length}) ${j.guard ? `guard=${j.guard.kind}` : ""} ${j.followup ? `→ ${j.followup.id}: ${j.followup.question}` : ""} ${j.error ?? ""}`);
  out.steps.push({ label, status: r.status, ms: r.ms, result: j });
};

console.log(`run ${runId}: legacy qa=${out.legacyQaInRun}, legacy follow-ups=${out.legacyFollowupsInRun}`);
// 1) ownership
if (otherJudge) {
  const r = await fu({ judgeId: otherJudge.id, questionId: strictQ.id, answer: "x" });
  check(r.status === 400, `judge ${otherJudge.id} answering ${strictQ.id} → ${r.status} ${r.json.error ?? ""}`);
}
// 2) session A: evasive → follow-up expected (the reviewer saw a forced 'next' here)
const EVASIVE = "음 그건 잘 모르겠습니다.";
const a1 = await fu({ judgeId: strictQ.judgeId, questionId: strictQ.id, answer: EVASIVE });
show("A1 evasive", a1);
const A = a1.json.attemptId;
check(a1.status === 200 && /^a_/.test(A ?? ""), `server created attempt ${A}`);
check(a1.json.decision === "followup" && a1.json.followup?.id === `${strictQ.id}_f1`, `fresh session: evasive answer → follow-up ${a1.json.followup?.id ?? "(none)"} (cap not pre-used by old sessions)`);
check(!/번복|앞선 질문|이전 답변/.test(a1.json.assessment?.reason ?? ""), `assessment does not refer to answers from other sessions: "${a1.json.assessment?.reason}"`);
check((a1.json.remark ?? "").length <= 40, `remark ≤ 40자 (${(a1.json.remark ?? "").length})`);
// 3) strong correction on the follow-up, same session
if (a1.json.followup) {
  const STRONG = "정정드리겠습니다. 제안서의 210억 원, SAM 6,800억 원의 약 3.1%가 최종 수치입니다. 발표자료의 340억 원은 초기 버전 수치로, 생산능력을 반영해 보수적으로 낮췄고 덱도 바로 정정해 공유드리겠습니다.";
  const a2 = await fu({ judgeId: strictQ.judgeId, questionId: a1.json.followup.id, answer: STRONG, attemptId: A });
  show("A2 strong", a2);
  const j = a2.json;
  check(a2.status === 200, "follow-up question found inside session A");
  check(!(j.decision === "followup" && j.assessment?.verdict === "충분"), `verdict/decision consistent: ${j.assessment?.verdict} → ${j.decision}`);
  if (j.followup) check(!/매출총이익률|이익률|14%|28%/.test(j.followup.question), `follow-up does not re-ask a queued topic: ${j.followup.question}`);
}
// 4) session B on the same run: count + thread reset
const B = `a_${Date.now().toString(36)}test`;
const b1 = await fu({ judgeId: strictQ.judgeId, questionId: strictQ.id, answer: EVASIVE, attemptId: B });
show("B1 evasive (new session)", b1);
check(b1.json.attemptId === B, `client-chosen attempt id kept (${b1.json.attemptId})`);
check(b1.json.decision === "followup" ? b1.json.followup?.id === `${strictQ.id}_f1` : true, `session B follow-up numbering restarts at _f1 (${b1.json.followup?.id ?? b1.json.decision})`);
// follow-up id of session A is unknown in session B
if (a1.json.followup) {
  const x = await fu({ judgeId: strictQ.judgeId, questionId: a1.json.followup.id, answer: "x", attemptId: `a_${Date.now().toString(36)}none` });
  check(x.status === 404, `session A's follow-up is not visible from another session → ${x.status}`);
}
// 5) attempts on disk + run untouched
const ra = await (await fetch(`${BASE}/api/question/runs/${runId}?attempt=${A}`)).json();
const rb = await (await fetch(`${BASE}/api/question/runs/${runId}?attempt=${B}`)).json();
check(ra.attempt?.qa.length >= 1 && rb.attempt?.qa.length === 1, `attempt logs: A=${ra.attempt?.qa.length}, B=${rb.attempt?.qa.length}`);
check(md5() === before, `run file unchanged (md5 ${before.slice(0, 8)})`);
// 6) save session from attempt B (no client qa) → SessionRecord holds only B's turn
const s = await post("/api/question/sessions", { runId, attemptId: B, qa: [] });
check(s.status === 200 && s.json.qa === 1, `session saved from attempt B: ${s.json.id} qa=${s.json.qa}`);
const meta = JSON.parse(readFileSync(`.data/question/sessions/${s.json.id}.meta.json`, "utf8"));
check(meta.attemptId === B, `session meta.attemptId = ${meta.attemptId}`);
check(md5() === before, "run file still unchanged after session save");
out.fail = fail;
writeFileSync("question/samples/attempts.json", JSON.stringify(out, null, 2));
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
