// Client-side session model (IndexedDB "pr-sim" → store "sessions"), per docs/wiki/api-contract.md.
// Server-side shapes are imported type-only from the client-safe src/server/**/types.ts files.
import type { DocRole, Gender, JudgePersona, QAItem, TranscriptSentence } from "@/server/types";
import type { KeyNumber, LintIssue, WikiPage } from "@/server/wiki/types";
import type { AnswerAssessment, ContextPack, Evidence, GeneratedQuestion } from "@/server/question/types";
import type { Report } from "@/server/report/types";

export type { DocInput, DocRole, Temperament, TranscriptSentence } from "@/server/types";
export type { RollAvoid } from "@/server/judge/types";
export type { GeneratedQuestion, QJudge } from "@/server/question/types";
export type { Report, ReportInput } from "@/server/report/types";

type SessionStatus = "setup" | "presentation" | "qa" | "report" | "done";
type Phase = "presentation" | "qa";

export interface StoredDoc {
  role: DocRole;
  docId: string; // sha256(PDF bytes) first 16 hex chars
  filename: string;
  bytes: number;
  pageCount: number;
  pdfKey: string; // blobs key "pdf:<docId>"
  pageTexts: string[];
  emptyPages: number[];
  wikiState: "pending" | "building" | "ready" | "error";
  wikiError?: string;
  wiki?: WikiPage[];
  keyNumbers?: KeyNumber[];
  wikiBuiltAt?: string;
  /** The wiki was written (in part) by a last-resort lite model (/api/wiki done.degraded); `wikiModel` names it. */
  wikiDegraded?: boolean;
  wikiModel?: string;
}

export interface StoredJudge extends JudgePersona {
  gender: Gender;
  age: number;
  fullName: string;
  voiceHint: string;
  imageKey: string; // blobs "judge:<id>" (1024px webp)
  thumbKey: string; // blobs "judge:<id>:thumb" (256px)
}

export type StoredQA = QAItem & {
  questionId: string;
  followup?: boolean;
  evidence: Evidence[];
  answerSentenceIds: string[]; // transcript (phase "qa") sentences of this answer
  assessment?: AnswerAssessment;
  decision?: "followup" | "next";
  remark?: string;
};

export interface SessionRecord {
  id: string;
  status: SessionStatus;
  resume?: { phase: Phase; remainingSec: number }; // 07 history "이어하기"
  setup: { situation: string; presentationMinutes: number; qaMinutes: number };
  docs: { presentation?: StoredDoc; proposal?: StoredDoc };
  judges: StoredJudge[];
  transcript: TranscriptSentence[];
  questions?: { pack: ContextPack; lint: LintIssue[]; items: GeneratedQuestion[]; order: string[]; main: string[]; reserve: string[] };
  qa: StoredQA[];
  report?: Report; // DocRef (pages) + sentenceId (transcript) citations
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

// ── POST /api/tts body (the other request bodies are GenerateInput, FollowUpRequest, ReportInput above) ──

export interface TtsRequest {
  text: string; // 1–1200 chars
  gender: Gender;
  age: number; // 20–70
  temperament: JudgePersona["temperament"];
}
