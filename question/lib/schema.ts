// zod schemas: LLM structured output + API input validation. (Isomorphic.)
import { z } from "zod";

// LLM output (OpenAI strict json_schema / Claude output_config.format): every field required, no bounds
// keywords (clamped in code instead).
export const EvidenceOut = z.object({
  doc: z.enum(["presentation", "proposal", "transcript"]),
  page: z.number().nullable(),
  quote: z.string(),
});

export const QuestionOut = z.object({
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

export const QJudgeIn = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(20),
  temperament: Temperament,
  gender: z.enum(["male", "female"]),
  age: z.number().int().min(20).max(80),
  imageUrl: z.string().max(300).optional(),
  fullName: z.string().max(30).optional(),
});

export const TranscriptIn = z.object({
  t: z.number().nonnegative(),
  text: z.string().min(1).max(2000),
  phase: z.enum(["presentation", "qa"]),
});

const DocId = z.string().regex(/^[a-f0-9]{16}$/);

export const GenerateIn = z.object({
  situation: z.string().max(4000).default(""),
  qaMinutes: z.number().min(1).max(20).default(3),
  presentationMinutes: z.number().min(1).max(30).optional(),
  transcript: z.array(TranscriptIn).max(2000).default([]),
  presentationDocId: DocId.optional(),
  proposalDocId: DocId.optional(),
  judges: z
    .array(QJudgeIn)
    .min(1)
    .max(3)
    .refine((js) => new Set(js.map((j) => j.id)).size === js.length, { message: "심사위원 id가 중복됩니다" }),
  fastContext: z.boolean().optional(),
  questionCount: z.number().int().min(1).max(12).optional(),
  avoidQuestions: z.array(z.string().max(400)).max(30).optional(),
});

export const FollowUpIn = z.object({
  runId: z.string().regex(/^r_[a-z0-9]+$/),
  judgeId: z.string().min(1).max(64),
  questionId: z.string().min(1).max(80),
  answer: z.string().max(4000),
  thread: z.array(z.object({ question: z.string().max(1000), answer: z.string().max(4000) })).max(6).optional(),
  remainingSec: z.number().optional(),
  attemptId: z.string().regex(/^a_[a-z0-9]{4,40}$/).optional(),
});

export const TtsIn = z.object({
  text: z.string().min(1).max(600),
  gender: z.enum(["male", "female"]),
  age: z.number().int().min(20).max(80),
  temperament: Temperament,
});

export const SaveSessionIn = z.object({
  runId: z.string().regex(/^r_[a-z0-9]+$/),
  attemptId: z.string().regex(/^a_[a-z0-9]{4,40}$/).optional(),
  qa: z
    .array(
      z.object({
        questionId: z.string().max(80),
        judgeId: z.string().max(64),
        question: z.string().min(1).max(1000),
        answer: z.string().max(4000),
        askedAt: z.number().nonnegative().optional(),
        followup: z.boolean().optional(),
        assessment: z.object({ score: z.number(), verdict: z.enum(["충분", "부분", "회피", "부정확"]), reason: z.string() }).optional(),
        decision: z.enum(["followup", "next"]).optional(),
        remark: z.string().optional(),
      }),
    )
    .max(60),
});

export const RetryIn = z.object({
  runId: z.string().regex(/^r_[a-z0-9]+$/),
  judgeIds: z.array(z.string().min(1).max(64)).min(1).max(3).optional(),
});
