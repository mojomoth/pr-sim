import "server-only";
// Public server API of the question PoC (see question/README.md).
//   buildContext(input)        → ContextPack (wiki queries on both docs, raw pages, cross-doc targets)
//   generateQuestions(input)   → QuestionRun (persona questions per judge, grounded evidence, round-robin order)
//   retryJudges(runId, ids?)   → QuestionRun (regenerate failed judges into the same run, stored context reused)
//   followUp(input)            → FollowUpResult (judge decides follow-up vs next, assessment) — scoped to a QAAttempt
//   saveSession(runId, qa)     → SessionRecord in .data/question/sessions/ (report PoC input)
export { buildContext, extractClaims, compareKeyNumbers, transcriptText } from "./context";
export { generateQuestions, retryJudges, plannedQuestionCount, assignTargets, orderQuestions, SECONDS_PER_EXCHANGE } from "./generate";
export { followUp, clampRemark, duplicateOfPending, FollowUpInputError, MIN_SEC_FOR_FOLLOWUP, REMARK_MAX } from "./followup";
export { groundEvidence } from "./ground";
export { saveSession, setupData, warmLint, ensureFixtureDocs, scriptTranscript, sampleSetup, generatedJudges } from "./session";
export { loadRun, loadAttempt, loadSession, listSessions, listRuns, type RunSummary } from "./store";
export { friendlyError, ProvidersUnavailableError, downSummary } from "./providers";
export { providerLabel, ROLE_MODELS } from "./llm";
export { PERSONAS, SHARED_RULES, FOLLOWUP_RULES } from "./personas";
export type * from "./types";
