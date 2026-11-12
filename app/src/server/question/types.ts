// Public types of the question PoC (client-safe: no server imports).
import type { DocInput, DocRole, JudgePersona, TranscriptSentence } from "../types";
import type { LintIssue } from "../wiki/types";

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

export interface GenerateInput {
  situation: string;
  qaMinutes: number;
  presentationMinutes?: number;
  transcript: TranscriptSentence[];
  docs: DocInput[];
  judges: QJudge[];
  avoidQuestions?: string[];
  pack?: ContextPack;
  lint?: LintIssue[];
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

/** Everything the judges see, plus inspector metadata. Returned to the client. */
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
  | { type: "plan"; plannedCount: number; perJudge: number; assignments: { judgeId: string; targetIds: string[] }[]; provider: string }
  | { type: "delta"; judgeId: string; index: number; text: string }
  | { type: "question"; question: GeneratedQuestion }
  | { type: "judge-done"; judgeId: string; usage: LlmUsage; count: number }
  | { type: "done"; questions: GeneratedQuestion[]; pack: ContextPack; lint: LintIssue[]; order: string[]; main: string[]; reserve: string[]; timings: Record<string, number>; usage: LlmUsage[]; degraded: boolean }
  | { type: "error"; message: string; judgeId?: string };

export interface AnswerAssessment {
  score: number; // 1–5
  verdict: "충분" | "부분" | "회피" | "부정확";
  reason: string;
}

export interface FollowUpRequest {
  packText: string;
  judge: QJudge;
  asked: GeneratedQuestion;
  original: GeneratedQuestion;
  answer: string;
  /** Earlier answered turns on this topic, excluding the current asked/answer. */
  thread: { question: string; answer: string }[];
  followupsSoFar: number;
  remainingSec?: number;
  pending: GeneratedQuestion[];
  transcript: TranscriptSentence[];
  docs: { role: DocRole; pageTexts: string[] }[];
}

export interface FollowUpResult {
  decision: "followup" | "next";
  assessment: AnswerAssessment;
  remark: string; // spoken short reaction in persona
  followup: GeneratedQuestion | null;
  usage: LlmUsage;
  /** true when a last-resort Gemini lite model answered (lower quality; say so in the UI). */
  degraded: boolean;
  latencyMs: number;
  /** Set when the server overrode the model's "followup" decision (and why). */
  guard?: { kind: "cap" | "time" | "sufficient" | "duplicate" | "empty"; detail: string };
}

