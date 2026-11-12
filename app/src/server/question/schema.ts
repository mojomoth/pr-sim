import "server-only";
// zod schemas: LLM structured output + API input validation. (Isomorphic.)
import { z } from "zod";
import { DocIn, TranscriptIn } from "../wiki/schema";

// LLM output (OpenAI strict json_schema / Claude output_config.format): every field required, no bounds
// keywords (clamped in code instead).
const EvidenceOut = z.object({
  doc: z.enum(["presentation", "proposal", "transcript"]),
  page: z.number().nullable(),
  quote: z.string(),
});

const QuestionOut = z.object({
  question: z.string(),
  intent: z.string(),
  targetClaim: z.string(),
  targetId: z.string().nullable(),
  evidence: z.array(EvidenceOut),
  difficulty: z.number(),
});
export type QuestionOutT = z.infer<typeof QuestionOut>;

export const QuestionsOut = z.object({ questions: z.array(QuestionOut) });

export const FollowUpOut = z.object({
  assessment: z.object({
    score: z.number(),
    verdict: z.enum(["충분", "부분", "회피", "부정확"]),
    reason: z.string(),
  }),
  decision: z.enum(["followup", "next"]),
  remark: z.string(),
  followup: QuestionOut.nullable(),
});

// ---- API inputs ----
const Temperament = z.enum(["friendly", "strict", "aggressive"]);

const QJudgeIn = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(20),
  temperament: Temperament,
  gender: z.enum(["male", "female"]),
  age: z.number().int().min(20).max(80),
  imageUrl: z.string().max(300).optional(),
  fullName: z.string().max(30).optional(),
});

const DocRoleIn = z.enum(["presentation", "proposal"]);
const EvidenceDocIn = z.enum(["presentation", "proposal", "transcript"]);
const SeverityIn = z.enum(["high", "medium", "low"]);
const PageIn = z.number().int().min(1).max(10_000);
const IdIn = z.string().min(1).max(120);
const PageListIn = z.array(PageIn).max(1000);
const CountIn = z.number().int().nonnegative();

export const EvidenceIn = z.object({
  doc: EvidenceDocIn, page: PageIn.nullable(), quote: z.string().max(4000),
  verified: z.boolean().optional(), correctedPage: PageIn.nullable().optional(),
});
export const GeneratedQuestionIn = z.object({
  id: IdIn, judgeId: z.string().min(1).max(64), question: z.string().max(2000),
  intent: z.string().max(4000), targetClaim: z.string().max(4000),
  evidence: z.array(EvidenceIn).max(20), difficulty: z.number().min(1).max(5),
  targetId: IdIn.nullable().optional(), kind: z.enum(["main", "reserve", "followup"]),
  parentId: IdIn.optional(), latencyMs: z.number().nonnegative().optional(),
});
export const LintIssueIn = z.object({
  type: z.enum(["contradiction", "cross-doc-mismatch", "orphan", "broken-link", "missing-citation", "bad-citation", "gap", "missing-page", "stale"]),
  severity: SeverityIn, message: z.string().max(10_000),
  pages: z.array(z.string().max(200)).max(1000), citations: PageListIn, otherCitations: PageListIn.optional(),
});
export const ContextPackIn = z.object({
  id: IdIn, createdAt: z.string().max(100), situation: z.string().max(4000), transcriptSentences: CountIn,
  presentationDocId: z.string().max(120).optional(), proposalDocId: z.string().max(120).optional(),
  queries: z.array(z.object({
    doc: DocRoleIn, docId: z.string().max(120), purpose: z.enum(["claim", "risk", "numbers"]),
    query: z.string().max(10_000), pages: z.array(z.string().max(200)).max(200),
    contextChars: CountIn, ms: z.number().nonnegative(),
  })).max(100),
  rawPages: z.array(z.object({
    doc: DocRoleIn, page: PageIn, chars: CountIn, score: z.number(), reason: z.string().max(1000),
  })).max(2000),
  targets: z.array(z.object({
    id: IdIn, kind: z.enum(["mismatch", "gap", "claim", "number-conflict"]),
    title: z.string().max(1000), detail: z.string().max(10_000), severity: SeverityIn,
    refs: z.array(z.object({ doc: EvidenceDocIn, pages: PageListIn })).max(20),
    unverifiedNumbers: z.array(z.string().max(200)).max(200).optional(),
  })).max(100),
  sections: z.array(z.object({
    key: z.enum(["situation", "transcript", "targets", "presentation-wiki", "proposal-wiki", "raw", "numbers"]),
    title: z.string().max(1000), chars: CountIn, approxTokens: CountIn,
  })).max(30),
  text: z.string().max(200_000), chars: CountIn, approxTokens: CountIn,
  fullTextChars: z.object({ presentation: CountIn, proposal: CountIn, transcript: CountIn }),
  lint: z.object({ used: z.boolean(), cached: z.boolean(), ms: z.number().nonnegative(), issues: CountIn }),
  ms: z.number().nonnegative(),
});
export const GenerateIn = z.object({
  situation: z.string().max(4000).default(""), qaMinutes: z.number().min(1).max(20),
  presentationMinutes: z.number().min(1).max(30).optional(), transcript: z.array(TranscriptIn).max(2000),
  docs: z.array(DocIn).min(1).max(2).refine((ds) => new Set(ds.map((d) => d.role)).size === ds.length, { message: "문서 역할이 중복됩니다" }),
  judges: z.array(QJudgeIn).min(1).max(3).refine((js) => new Set(js.map((j) => j.id)).size === js.length, { message: "심사위원 id가 중복됩니다" }),
  avoidQuestions: z.array(z.string().max(400)).max(30).optional(), pack: ContextPackIn.optional(),
  lint: z.array(LintIssueIn).max(200).optional(),
});
export const FollowUpIn = z.object({
  packText: z.string().max(200_000), judge: QJudgeIn, asked: GeneratedQuestionIn, original: GeneratedQuestionIn,
  answer: z.string().max(4000),
  thread: z.array(z.object({ question: z.string().max(2000), answer: z.string().max(4000) })).max(6),
  followupsSoFar: z.number().int().nonnegative(), remainingSec: z.number().optional(),
  pending: z.array(GeneratedQuestionIn).max(30), transcript: z.array(TranscriptIn).max(2000),
  docs: z.array(z.object({ role: DocRoleIn, pageTexts: z.array(z.string().max(150_000)).max(1000) })).max(2)
    .refine((ds) => new Set(ds.map((d) => d.role)).size === ds.length, { message: "문서 역할이 중복됩니다" }),
});
