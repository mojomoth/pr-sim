// Public types of the question PoC (client-safe: no server imports).
import type { JudgePersona, QAItem, Temperament, TranscriptSentence } from "@/lib/types";

export type EvidenceDoc = "presentation" | "proposal" | "transcript";

export interface Evidence {
  doc: EvidenceDoc;
  page: number | null; // 1-based raw page for presentation/proposal; null for transcript
  quote: string;
  /** Set by grounding check: quote found verbatim (whitespace-normalized) in raw page / transcript. */
  verified?: boolean;
  /** If the quote was found on a different page than the model claimed, the corrected page. */
  correctedPage?: number | null;
}

export interface GeneratedQuestion {
  id: string; // q_<judge>_<n>
  judgeId: string;
  question: string; // spoken Korean, 1–2 sentences
  intent: string;
  targetClaim: string;
  evidence: Evidence[];
  difficulty: number; // 1–5
  /** Focus targets assigned to the judge (ids from ContextPack.targets) this question addresses, if any. */
  targetId?: string | null;
  kind: "main" | "reserve" | "followup";
  parentId?: string; // for follow-ups
  latencyMs?: number;
}

/** Judge as used by this PoC (gender/age needed for the voice). */
export interface QJudge extends JudgePersona {
  gender: "male" | "female";
  age: number;
  fullName?: string;
}

export type TranscriptSource = "sample-session" | "script" | "live" | "custom";

export interface GenerateInput {
  situation: string;
  qaMinutes: number;
  presentationMinutes?: number;
  transcript: TranscriptSentence[];
  presentationDocId?: string;
  proposalDocId?: string;
  judges: QJudge[];
  /** Skip the LLM cross-doc lint (uses only deterministic key-number comparison). */
  fastContext?: boolean;
  /** Override number of main questions (default: from time budget). */
  questionCount?: number;
  /** Questions asked in earlier runs ("다시 생성"): judges must take a different angle. */
  avoidQuestions?: string[];
}

export interface WikiQueryLog {
  doc: "presentation" | "proposal";
  docId: string;
  purpose: "claim" | "risk" | "numbers";
  query: string;
  pages: string[]; // wiki slugs returned
  contextChars: number;
  ms: number;
}

export interface RawPageRef {
  doc: "presentation" | "proposal";
  page: number;
  chars: number;
  score: number;
  reason: string;
}

export interface FocusTarget {
  id: string; // t1..tn
  kind: "mismatch" | "gap" | "claim" | "number-conflict";
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  refs: { doc: EvidenceDoc; pages: number[] }[];
  /** Numbers in an LLM-written (lint) detail that do not occur in any source text — unverified. */
  unverifiedNumbers?: string[];
}

export interface ContextSection {
  key: "situation" | "transcript" | "targets" | "presentation-wiki" | "proposal-wiki" | "raw" | "numbers";
  title: string;
  chars: number;
  approxTokens: number;
}

/** Everything the judges see, plus inspector metadata. Persisted per run. */
export interface ContextPack {
  id: string;
  createdAt: string;
  situation: string;
  transcriptSentences: number;
  presentationDocId?: string;
  proposalDocId?: string;
  queries: WikiQueryLog[];
  rawPages: RawPageRef[];
  targets: FocusTarget[];
  sections: ContextSection[];
  text: string; // the rendered prompt context (shared prefix for every judge call)
  chars: number;
  approxTokens: number;
  fullTextChars: { presentation: number; proposal: number; transcript: number };
  lint: { used: boolean; cached: boolean; ms: number; issues: number };
  ms: number;
}

export interface LlmUsage {
  provider: "claude" | "openai" | "gemini";
  model: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  ms: number;
  ttftMs?: number;
}

export type GenerateEvent =
  | { type: "stage"; stage: "context" | "plan" | "generate" | "ground" | "done"; msg: string; ms?: number }
  | { type: "context"; pack: Omit<ContextPack, "text"> & { preview: string } }
  | { type: "plan"; runId: string; plannedCount: number; perJudge: number; assignments: { judgeId: string; targetIds: string[] }[]; provider: string }
  | { type: "delta"; judgeId: string; index: number; text: string }
  | { type: "question"; question: GeneratedQuestion }
  | { type: "judge-done"; judgeId: string; usage: LlmUsage; count: number }
  | { type: "done"; runId: string; order: string[]; main: string[]; reserve: string[]; timings: Record<string, number>; usage: LlmUsage[] }
  | { type: "error"; message: string; judgeId?: string };

export interface AnswerAssessment {
  score: number; // 1–5
  verdict: "충분" | "부분" | "회피" | "부정확";
  reason: string;
}

export interface FollowUpInput {
  runId: string;
  judgeId: string;
  questionId: string;
  answer: string;
  /** Earlier turns in this thread (original question + follow-ups with answers). */
  thread?: { question: string; answer: string }[];
  remainingSec?: number;
  /**
   * Q&A session ("attempt") this answer belongs to. The thread, the follow-up count and the follow-up
   * questions are scoped to it, so replaying a saved run starts clean. Omit on the first call → the
   * server creates one and returns it; pass it back on every later call of the same Q&A session.
   */
  attemptId?: string;
}

export interface FollowUpResult {
  decision: "followup" | "next";
  assessment: AnswerAssessment;
  remark: string; // spoken short reaction in persona
  followup: GeneratedQuestion | null;
  usage: LlmUsage;
  latencyMs: number;
  attemptId: string;
  /** Set when the server overrode the model's "followup" decision (and why). */
  guard?: { kind: "cap" | "time" | "sufficient" | "duplicate" | "empty"; detail: string };
}

export type QALogEntry = QAItem & { questionId: string; followup?: boolean; assessment?: AnswerAssessment; decision?: "followup" | "next"; remark?: string };

/** One Q&A session on a run (a fresh one per "질의응답 시작", also when replaying a saved run). */
export interface QAAttempt {
  id: string; // a_<...>
  runId: string;
  createdAt: string;
  updatedAt: string;
  /** Follow-up questions generated during THIS session only. */
  followups: GeneratedQuestion[];
  qa: QALogEntry[];
}

/** Stored run: inputs + context + generated questions + QA log. */
export interface QuestionRun {
  id: string;
  createdAt: string;
  input: GenerateInput;
  pack: ContextPack;
  questions: GeneratedQuestion[];
  order: string[];
  main: string[];
  reserve: string[];
  usage: LlmUsage[];
  timings: Record<string, number>;
  /** Legacy (runs before attempts existed). New runs keep this empty: Q&A lives in QAAttempt files. */
  qa: QALogEntry[];
  /** Judges whose generation failed and were regenerated later (retryJudges). */
  retried?: { at: string; judgeIds: string[] }[];
}

export const TEMPERAMENT_DESC: Record<Temperament, string> = {
  friendly: "격려하며 설명을 넓혀 달라고 요청",
  strict: "숫자·근거·논리·정합성을 엄격히 확인",
  aggressive: "가정에 도전하고 모순·약점을 압박",
};
