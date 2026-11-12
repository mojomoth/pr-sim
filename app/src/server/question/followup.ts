import "server-only";
import { clampDifficulty, cleanQuestion } from "./generate";
import { groundEvidence } from "./ground";
import { streamJson, withRetry } from "./llm";
import { FOLLOWUP_RULES, PERSONAS, personaSystem, SHARED_RULES } from "./personas";
import { FollowUpOut } from "./schema";
import { clampRemark, duplicateOfPending, REMARK_MAX } from "./guards";
import type { FollowUpRequest, FollowUpResult } from "./types";


/** Minimum remaining Q&A seconds to still allow a follow-up on the same topic. */
const MIN_SEC_FOR_FOLLOWUP = 45;
/** Thrown for a request that is well-formed but inconsistent (→ HTTP 400). */
export class FollowUpInputError extends Error {}

/** Judge assessment and follow-up using the context and thread supplied by the client. */
export async function followUp(input: FollowUpRequest, opts: { signal?: AbortSignal } = {}): Promise<FollowUpResult> {
  const t0 = Date.now();
  const { judge, asked, original, pending, followupsSoFar } = input;
  if (asked.judgeId !== judge.id) throw new FollowUpInputError(`이 질문(${asked.id})은 다른 심사위원의 질문입니다 (judgeId 불일치)`);
  const turns = [...input.thread, { question: asked.question, answer: input.answer }];
  const persona = PERSONAS[judge.temperament];
  const capReached = followupsSoFar >= persona.maxFollowups;
  const lowTime = input.remainingSec != null && input.remainingSec < MIN_SEC_FOR_FOLLOWUP;
  const answerText = input.answer.trim() || "(답변 없음 — 발표자가 아무 말도 하지 않았습니다)";

  const user = `[처음 질문의 의도] ${original.intent}
[겨냥한 주장] ${original.targetClaim}
[처음 질문의 근거] ${original.evidence.map((e) => `${e.doc}${e.page ? ` p.${e.page}` : ""}: "${e.quote}"`).join(" / ") || "(없음)"}

[대화]
${turns.map((t, i) => `${i === 0 ? "질문" : `꼬리질문 ${i}`}: ${t.question}\n발표자 답변: ${i === turns.length - 1 ? answerText : t.answer || "(답변 없음)"}`).join("\n")}

[이후 예정된 다른 질문 — 꼬리질문은 이 주제들을 미리 묻지 말고 지금 주제(${original.targetClaim})에만 머무르세요]
${pending.slice(0, 8).map((q) => `- ${q.targetClaim}`).join("\n") || "(없음)"}

[제약] 지금까지 꼬리질문 ${followupsSoFar}회 / 성향 한도 ${persona.maxFollowups}회.${capReached ? " 한도에 도달했으므로 decision은 반드시 \"next\"." : ""}${lowTime ? ` 남은 질의응답 시간 ${Math.round(input.remainingSec!)}초 — 시간이 부족하므로 decision은 반드시 "next".` : input.remainingSec != null ? ` 남은 질의응답 시간 약 ${Math.round(input.remainingSec)}초.` : ""}
verdict가 "충분"이면 decision은 "next"입니다. remark는 ${REMARK_MAX}자 이내 한 문장.
JSON으로만 답하세요.`;

  const { data, usage } = await withRetry(() =>
    streamJson({
      role: "followup",
      name: "judge_followup",
      shared: `${SHARED_RULES}\n\n${input.packText}`,
      persona: `${personaSystem(judge.temperament, judge)}\n\n${FOLLOWUP_RULES}`,
      user,
      schema: FollowUpOut,
      signal: opts.signal,
    }),
  );

  const assessment = {
    score: Math.max(1, Math.min(5, Math.round(data.assessment.score))),
    verdict: data.assessment.verdict,
    reason: data.assessment.reason.trim(),
  };

  // ---- guards: the model proposes, the server disposes ----
  let guard: FollowUpResult["guard"];
  if (data.decision === "followup") {
    if (capReached) guard = { kind: "cap", detail: `꼬리질문 한도 ${persona.maxFollowups}회 도달` };
    else if (lowTime) guard = { kind: "time", detail: `남은 시간 ${Math.round(input.remainingSec!)}초 < ${MIN_SEC_FOR_FOLLOWUP}초` };
    else if (!data.followup) guard = { kind: "empty", detail: "꼬리질문 내용 없음" };
    else if (assessment.verdict === "충분") guard = { kind: "sufficient", detail: `평가가 '충분'(${assessment.score}/5)이라 다음 질문으로` };
    else {
      const topicText = [original.question, original.intent, original.targetClaim, ...original.evidence.map((e) => e.quote), ...turns.map((t) => `${t.question} ${t.answer}`)].join(" ");
      const dup = duplicateOfPending({ question: data.followup.question, targetClaim: data.followup.targetClaim }, topicText, pending);
      if (dup) guard = { kind: "duplicate", detail: `예정된 질문 ${dup.id}과 겹쳐 다음 질문으로` };
    }
  }
  const decision: FollowUpResult["decision"] = data.decision === "followup" && !guard ? "followup" : "next";

  let followup: FollowUpResult["followup"] = null;
  if (decision === "followup" && data.followup) {
    followup = {
      id: `${original.id}_f${followupsSoFar + 1}`,
      judgeId: judge.id,
      question: cleanQuestion(data.followup.question),
      intent: data.followup.intent.trim(),
      targetClaim: data.followup.targetClaim.trim(),
      targetId: original.targetId ?? null,
      evidence: groundEvidence(
        data.followup.evidence.slice(0, 4).map((e) => ({ doc: e.doc, page: e.page == null ? null : Math.round(e.page), quote: e.quote.trim() })),
        { pages: Object.fromEntries(input.docs.map((d) => [d.role, d.pageTexts])), transcript: input.transcript },
      ),
      difficulty: clampDifficulty(data.followup.difficulty, judge.temperament),
      kind: "followup",
      parentId: original.id,
      latencyMs: Date.now() - t0,
    };
  }
  const remark = clampRemark(data.remark, judge.temperament);

  return { decision, assessment, remark, followup, usage, latencyMs: Date.now() - t0, ...(guard ? { guard } : {}) };
}
