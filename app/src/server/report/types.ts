// Public types of the report module (client-safe: no server imports).
import type { Temperament, TranscriptSentence, QAItem, DocInput, DocRole } from "../types";

import type { LintIssue } from "../wiki/types";

export const REPORT_VERSION = 4;

// ───────────────────────── 1. deterministic speech metrics ─────────────────────────

export interface FillerHit {
  word: string;
  kind: "hesitation" | "habit"; // 간투사(음/어/그…) | 습관어(이제/약간/그러니까…)
  count: number;
}

export interface FillerExample {
  sentenceId: string;
  t: number;
  text: string;
  words: string[];
}

export interface PauseHit {
  afterSentenceId: string;
  t: number; // start of the pause (s)
  seconds: number;
}

export interface RepeatHit {
  kind: "stutter" | "word" | "opener";
  text: string;
  count: number;
}

export interface SpeechMetrics {
  sentenceCount: number;
  syllables: number; // Hangul syllables + digits + latin·0.7 + %→3 (approx. spoken syllables)
  /** estimated articulation rate (syll/s), 75th pct of consecutive-sentence rates, clamped 4–9 */
  articulationSps: number;
  /** first sentence start → estimated end of the last sentence (s) */
  spokenSeconds: number;
  targetSeconds: number;
  /** spokenSeconds / targetSeconds */
  timeUsage: number;
  timeStatus: "short" | "ok" | "over";
  syllablesPerMinute: number;
  sentencesPerMinute: number;
  rateStatus: "slow" | "ok" | "fast";
  /** per-minute syllable counts (bucketed by sentence start) */
  rateTimeline: { minute: number; syllables: number }[];
  avgSentenceSyllables: number;
  maxSentenceSyllables: number;
  maxSentence: { sentenceId: string; text: string } | null;
  longSentences: number; // > LONG_SENTENCE syllables
  fillers: {
    total: number;
    perMinute: number;
    per100Syllables: number;
    byWord: FillerHit[];
    examples: FillerExample[];
  };
  repetition: RepeatHit[];
  pauses: {
    threshold: number;
    count: number;
    longest: number;
    totalSeconds: number;
    items: PauseHit[];
  };
  /** 0–100 deterministic delivery score (rate, fillers, pauses, time, sentence length) */
  deliveryScore: number;
  deliveryPenalties: { reason: string; points: number }[];
}

// ───────────────────────── shared refs ─────────────────────────

export const DOC_LABEL: Record<DocRole, string> = { presentation: "발표자료", proposal: "제안자료" };

export interface DocRef {
  doc: DocRole;
  pages: number[]; // raw page numbers (1-based) — re-grounded against the raw text when possible
  quote?: string | null; // the value/phrase as written in that document (used for page re-grounding)
  grounded?: boolean; // true = the quoted value was found on these raw pages
}

export interface Contradiction {
  claim: string; // what the presenter said
  docSays: string; // what the documents say
  refs: DocRef[];
  severity: "high" | "medium" | "low";
  /** speech numberIssues only: every figure the presenter said is printed on a cited page of this document — the
   *  documents disagree with each other, the presenter did not invent a number. Set in code (applyNumberPolicy);
   *  severity is forced to "low" (no logic penalty); the deck↔proposal mismatch is scored under 자료 품질 instead. */
  matchesDoc?: DocRole;
}

// ───────────────────────── 1b. LLM speech analysis ─────────────────────────

export interface SlideCoverage {
  page: number; // deck page
  title: string;
  status: "covered" | "partial" | "missing";
  sentenceIds: string[];
  note: string;
}

export interface SpeechAnalysis {
  scores: { structure: number; clarity: number; persuasiveness: number }; // 0–100
  summary: string;
  structureNote: string;
  clarityNote: string;
  persuasivenessNote: string;
  strengths: string[];
  improvements: string[];
  coverage: SlideCoverage[];
  coverageRate: number; // deterministic: (covered + 0.5·partial) / pages
  numberIssues: Contradiction[]; // numbers in the talk that contradict the documents
}

// ───────────────────────── 2. Q&A validity ─────────────────────────

export interface QAEvaluation {
  index: number;
  judge: { id: string; name: string; temperament: Temperament };
  question: string;
  answer: string;
  scores: { relevance: number; accuracy: number; evidence: number; completeness: number; composure: number };
  score: number; // 0–100 (deterministic weighted mean of the sub-scores)
  verdict: "strong" | "adequate" | "weak" | "evasive";
  feedback: string; // 2 short lines, judge voice (심사위원 피드백)
  rationale: string; // why this score
  contradictions: Contradiction[];
  evidenceUsed: string[]; // facts/numbers the answer used
  missing: string[]; // what a good answer should have included
  improvedAnswer: string; // 이렇게 답해 보세요
  citations: DocRef[]; // where the improved answer's facts come from
  answerFillers: number; // deterministic
}

// ───────────────────────── 3. document quality ─────────────────────────

export interface DocIssue {
  severity: "high" | "medium" | "low";
  category: "structure" | "logic" | "evidence" | "consistency" | "clarity";
  title: string;
  detail: string;
  refs: DocRef[];
  fix: string;
}

export interface DocEvaluation {
  role: DocRole;
  docId: string;
  filename: string;
  pageCount: number;
  scores: { structure: number; logic: number; evidence: number; consistency: number; clarity: number };
  score: number; // deterministic mean
  summary: string;
  strengths: string[];
  issues: DocIssue[];
}

export interface ConsistencyRow {
  metric: string;
  presentation: { value: string; pages: number[] } | null;
  proposal: { value: string; pages: number[] } | null;
  status: "match" | "mismatch" | "only-one";
  note: string;
}

export interface MaterialsSection {
  docs: DocEvaluation[];
  consistency: ConsistencyRow[];
  score: number | null;
}

// ───────────────────────── 4. overall ─────────────────────────

export interface SubScores {
  delivery: number | null; // 발표력
  logic: number | null; // 논리성
  response: number | null; // 대응력
  materials: number | null; // 자료 품질
}
export const SUBSCORE_LABEL: Record<keyof SubScores, string> = {
  delivery: "발표력",
  logic: "논리성",
  response: "대응력",
  materials: "자료 품질",
};

export interface Priority {
  title: string;
  why: string;
  how: string;
}

export interface Overall {
  total: number; // weighted over the sub-scores that exist; a sub-score is null ONLY when its input is absent (never on LLM failure — that aborts the report)
  sub: SubScores;
  weights: Record<keyof SubScores, number>;
  /** sub-scores left out of the total because the session has no input for them (e.g. no Q&A) */
  excluded?: { key: keyof SubScores; reason: string }[];
  headline: string; // 큰 제목 e.g. "답변에 근거를 더해 보세요."
  oneLiner: string; // 점수 카드 아래 한 줄
  strengths: string[]; // 2–3
  priorities: Priority[]; // top 3
}

// ───────────────────────── report ─────────────────────────

export interface ReportMeta {
  version: number;
  sessionId: string;
  situation: string;
  presentationMinutes: number;
  qaMinutes: number;
  judges: number;
  questions: number;
  docIds: { presentation?: string; proposal?: string };
  provider: string; // e.g. "claude:claude-opus-5-5" | "openai:gpt-5.5 (claude 사용 한도 → 폴백)"
  createdAt: string;
  ms: number;
  timings: Record<string, number>;
  usage: { calls: number; inputTokens: number; outputTokens: number; byModel?: Record<string, number> };
  warnings: string[];

}

export interface Report {
  meta: ReportMeta;
  speech: { metrics: SpeechMetrics; analysis: SpeechAnalysis | null };
  qa: QAEvaluation[];
  materials: MaterialsSection;
  overall: Overall;
}

// ───────────────────────── progress (NDJSON stream) ─────────────────────────

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";
export interface StepInfo {
  id: string; // metrics | docs | speech | qa:0 | doc:presentation | doc:proposal | consistency | overall
  group: "speech" | "qa" | "materials" | "overall" | "prep";
  label: string;
  status: StepStatus;
  ms?: number;
  detail?: string;
}
export type ProgressEvent =
  | { type: "steps"; steps: StepInfo[] }
  | { type: "step"; step: StepInfo }
  | { type: "done"; report: Report }
  | { type: "error"; code: "providers_unavailable" | "upstream" | "bad_request" | "timeout"; message: string; failedSteps?: string[]; retryable: boolean };

export interface ReportInput {
  id: string;
  situation: string;
  presentationMinutes: number;
  qaMinutes: number;
  judges: { id: string; name: string; temperament: Temperament }[];
  transcript: TranscriptSentence[];
  qa: QAItem[];
  docs: DocInput[];
  /** Cross-document lint issues returned earlier by /api/questions. */
  lint?: LintIssue[];
}
