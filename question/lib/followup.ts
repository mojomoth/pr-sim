import "server-only";
import { clampDifficulty, cleanQuestion } from "./generate";
import { groundEvidence } from "./ground";
import { streamJson, withRetry } from "./llm";
import { FOLLOWUP_RULES, PERSONAS, personaSystem, SHARED_RULES } from "./personas";
import { FollowUpOut } from "./schema";
import { loadRun, saveRun } from "./store";
import type { FollowUpInput, FollowUpResult, QuestionRun } from "./types";

/** Minimum remaining Q&A seconds to still allow a follow-up on the same topic. */
export const MIN_SEC_FOR_FOLLOWUP = 45;

/**
 * The judge hears the presenter's answer and decides: follow-up (same topic, deeper) or next question.
 * Uses the run's stored context so the judge can check the answer against the materials.
 * Appends the answered turn to run.qa (QAItem[] + assessment).
 */
export async function followUp(input: FollowUpInput, opts: { signal?: AbortSignal; run?: QuestionRun } = {}): Promise<FollowUpResult> {
  const t0 = Date.now();
  const run = opts.run ?? (await loadRun(input.runId));
  if (!run) throw new Error("run not found");
  const judge = run.input.judges.find((j) => j.id === input.judgeId);
  if (!judge) throw new Error("judge not found");
  const asked = run.questions.find((q) => q.id === input.questionId);
  if (!asked) throw new Error("question not found");
  const original = asked.parentId ? (run.questions.find((q) => q.id === asked.parentId) ?? asked) : asked;
  const inTopic = (id: string) => id === original.id || id.startsWith(`${original.id}_f`);

  // thread = earlier answered turns on this topic (from the run log unless the client passes it) + this one
  const prior = input.thread ?? run.qa.filter((x) => inTopic(x.questionId)).map((x) => ({ question: x.question, answer: x.answer }));
  const turns = [...prior, { question: asked.question, answer: input.answer }];
  const followupsSoFar = run.questions.filter((q) => q.parentId === original.id).length;
  const persona = PERSONAS[judge.temperament];
  const capReached = followupsSoFar >= persona.maxFollowups;
  const lowTime = input.remainingSec != null && input.remainingSec < MIN_SEC_FOR_FOLLOWUP;
  const answerText = input.answer.trim() || "(답변 없음 — 발표자가 아무 말도 하지 않았습니다)";

  const user = `[처음 질문의 의도] ${original.intent}
[겨냥한 주장] ${original.targetClaim}
[처음 질문의 근거] ${original.evidence.map((e) => `${e.doc}${e.page ? ` p.${e.page}` : ""}: "${e.quote}"`).join(" / ") || "(없음)"}

[대화]
${turns.map((t, i) => `${i === 0 ? "질문" : `꼬리질문 ${i}`}: ${t.question}\n발표자 답변: ${i === turns.length - 1 ? answerText : t.answer || "(답변 없음)"}`).join("\n")}

[제약] 지금까지 꼬리질문 ${followupsSoFar}회 / 성향 한도 ${persona.maxFollowups}회.${capReached ? " 한도에 도달했으므로 decision은 반드시 \"next\"." : ""}${lowTime ? ` 남은 질의응답 시간 ${Math.round(input.remainingSec!)}초 — 시간이 부족하므로 decision은 반드시 "next".` : input.remainingSec != null ? ` 남은 질의응답 시간 약 ${Math.round(input.remainingSec)}초.` : ""}
JSON으로만 답하세요.`;

  const { data, usage } = await withRetry(() =>
    streamJson({
      role: "followup",
      name: "judge_followup",
      shared: `${SHARED_RULES}\n\n${run.pack.text}`,
      persona: `${personaSystem(judge.temperament, judge)}\n\n${FOLLOWUP_RULES}`,
      user,
      schema: FollowUpOut,
      signal: opts.signal,
    }),
  );

  const forcedNext = capReached || lowTime;
  const decision = forcedNext || !data.followup ? "next" : data.decision;
  let followup: FollowUpResult["followup"] = null;
  if (decision === "followup" && data.followup) {
    followup = {
      id: `${original.id}_f${followupsSoFar + 1}`,
      judgeId: judge.id,
      question: cleanQuestion(data.followup.question),
      intent: data.followup.intent.trim(),
      targetClaim: data.followup.targetClaim.trim(),
      targetId: original.targetId ?? null,
      evidence: await groundEvidence(
        data.followup.evidence.slice(0, 4).map((e) => ({ doc: e.doc, page: e.page == null ? null : Math.round(e.page), quote: e.quote.trim() })),
        { presentationDocId: run.input.presentationDocId, proposalDocId: run.input.proposalDocId, transcript: run.input.transcript },
      ),
      difficulty: clampDifficulty(data.followup.difficulty, judge.temperament),
      kind: "followup",
      parentId: original.id,
      latencyMs: Date.now() - t0,
    };
    run.questions.push(followup);
  }
  const assessment = {
    score: Math.max(1, Math.min(5, Math.round(data.assessment.score))),
    verdict: data.assessment.verdict,
    reason: data.assessment.reason.trim(),
  };

  run.qa.push({
    judge: { id: judge.id, name: judge.name, temperament: judge.temperament },
    question: asked.question,
    answer: input.answer,
    questionId: asked.id,
    followup: asked.kind === "followup",
    assessment,
    decision,
    remark: data.remark.trim(),
  });
  await saveRun(run);

  return { decision, assessment, remark: data.remark.trim(), followup, usage, latencyMs: Date.now() - t0 };
}
