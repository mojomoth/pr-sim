// Unit checks for the follow-up guards (no server). Run: pnpm exec jiti question/tests/guards.ts
import { readFileSync } from "node:fs";
import { clampRemark, duplicateOfPending, REMARK_MAX } from "../lib/guards";
import type { QuestionRun } from "../lib/types";

let fail = 0;
const ok = (c: boolean, msg: string) => {
  console.log(`${c ? "PASS" : "FAIL"} ${msg}`);
  if (!c) fail++;
};

// reviewer case: run r_mwdn00iwkin6b — strict judge's follow-up on the SOM question switched to the gross-margin
// topic that is already the judge's queued q_judge-strict-1_2
const run = JSON.parse(readFileSync(".data/question/runs/r_mwdn00iwkin6b.json", "utf8")) as QuestionRun;
const q = Object.fromEntries(run.questions.map((x) => [x.id, x]));
const orig = q["q_judge-strict-1_1"];
const pending = [q["q_judge-strict-1_2"]];
const topic = [orig.question, orig.intent, orig.targetClaim, ...orig.evidence.map((e) => e.quote), "제안서의 210억 원이 최종 수치입니다. 정정해 공유드리겠습니다."].join(" ");
const dupF2 = duplicateOfPending(q["q_judge-strict-1_1_f2"], topic, pending);
ok(dupF2?.id === "q_judge-strict-1_2", `f2 (매출총이익률 14% vs 28%) flagged as duplicate of q_judge-strict-1_2 → ${dupF2?.id}`);
const dupF1 = duplicateOfPending(q["q_judge-strict-1_1_f1"], topic, pending);
ok(dupF1 == null, `f1 (same SOM topic, which doc is final) NOT flagged → ${dupF1?.id ?? "null"}`);
// same-topic follow-up that re-uses the original numbers must not be flagged
ok(duplicateOfPending({ question: "210억 원과 340억 원 중 어느 쪽이 투자 심사 기준입니까?", targetClaim: "SOM 210억/340억" }, topic, pending) == null, "same-topic numbers (210억/340억) not flagged");

const long = "정확한 근거 없이 답변하시면 곤란합니다. 둘 중 어느 수치가 유효한지 다시 말씀하십시오.";
const r1 = clampRemark(long, "strict");
ok(r1.length <= REMARK_MAX && r1 === "정확한 근거 없이 답변하시면 곤란합니다.", `long remark (${long.length}자) → "${r1}" (${r1.length}자)`);
const r2 = clampRemark("발표자료와 제안서의 수치가 서로 다른 이유를 전혀 설명하지 못하셨기 때문에 다시 여쭙겠습니다", "aggressive");
ok(r2 === "그건 답이 안 됩니다.", `single over-long sentence → persona default "${r2}"`);
ok(clampRemark("네, 잘 들었습니다.", "friendly") === "네, 잘 들었습니다.", "short remark unchanged");
ok(clampRemark("", "strict") === "알겠습니다.", "empty remark → default");
process.exit(fail ? 1 : 0);
