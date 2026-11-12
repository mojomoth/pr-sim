// Long spoken answer (9,000 chars, > 4,000 cap) to /api/questions/followup: was 400, now truncated server-side with a note.
import { writeFileSync } from "node:fs";
import { createJiti } from "../../../node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti.mjs";
const base = "네, 원가 구조에 대해 말씀드리면 해조류 부산물 단가는 톤당 18만 원이고 공정 수율은 72퍼센트입니다. ";
const long = base.repeat(Math.ceil(9000 / base.length)).slice(0, 9000);
const q = (id, kind) => ({ id, judgeId: "j2", question: "개당 원가 142원의 산출 근거를 설명해 주세요.", intent: "원가 근거 확인", targetClaim: "개당 원가 142원", evidence: [{ doc: "proposal", page: 12, quote: "개당 원가 142원" }], difficulty: 3, kind });
const body = {
  packText: "[상황] 시드 투자 IR. 제안자료 p.12: 개당 원가 142원, 판매가 260원.",
  judge: { id: "j2", name: "박준호", temperament: "strict", gender: "male", age: 52 },
  asked: q("q1", "main"), original: q("q1", "main"),
  answer: long,
  thread: [{ question: "이전 질문", answer: long }],
  followupsSoFar: 0, remainingSec: 200, pending: [], transcript: [], docs: [],
};
// 1) the real schema (no network): what the server hands to followUp()
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../../../src", import.meta.url).pathname, "server-only": new URL("../../../node_modules/.pnpm/server-only@0.0.1/node_modules/server-only/empty.js", import.meta.url).pathname } });
const { FollowUpIn } = await jiti.import("../../../src/server/question/schema.ts");
const parsed = FollowUpIn.parse(body);
const schema = { inChars: long.length, outChars: parsed.answer.length, tail: parsed.answer.slice(-40), threadOutChars: parsed.thread[0].answer.length, shortUnchanged: FollowUpIn.parse({ ...body, answer: "짧은 답", thread: [] }).answer === "짧은 답" };
// 2) live route
const t0 = Date.now();
const res = await fetch("http://localhost:3000/api/questions/followup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const json = await res.json();
const live = { status: res.status, ms: Date.now() - t0, decision: json.decision, verdict: json.assessment?.verdict, remark: json.remark, usage: json.usage, error: json.error };
const out = { schema, live };
writeFileSync(new URL("followup-long.out.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
