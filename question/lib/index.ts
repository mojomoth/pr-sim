import "server-only";
// Public server API of the question PoC (see question/README.md).
//   buildContext(input)        → ContextPack (wiki queries on both docs, raw pages, cross-doc targets)
//   generateQuestions(input)   → QuestionRun (persona questions per judge, grounded evidence, round-robin order)
//   followUp(input)            → FollowUpResult (judge decides follow-up vs next, assessment)
//   saveSession(runId, qa)     → SessionRecord in .data/question/sessions/ (report PoC input)
export { buildContext, extractClaims, compareKeyNumbers, transcriptText } from "./context";
export { generateQuestions, plannedQuestionCount, assignTargets, orderQuestions, SECONDS_PER_EXCHANGE } from "./generate";
export { followUp, MIN_SEC_FOR_FOLLOWUP } from "./followup";
export { groundEvidence } from "./ground";
export { saveSession, setupData, warmLint, ensureFixtureDocs, scriptTranscript, sampleSetup, generatedJudges } from "./session";
export { loadRun, loadSession, listSessions, listRuns, type RunSummary } from "./store";
export { friendlyError, ProvidersUnavailableError, downSummary } from "./providers";
export { providerLabel, ROLE_MODELS } from "./llm";
export { PERSONAS, SHARED_RULES, FOLLOWUP_RULES } from "./personas";
export type * from "./types";
