import "server-only";
import { z } from "zod";
import { DocIn, LintIssueIn, TranscriptIn } from "../wiki/schema";
import type { ReportInput } from "./types";

const JudgeIn = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  temperament: z.enum(["friendly", "strict", "aggressive"]),
});

const ReportInputIn = z.object({
  id: z.string().min(1).max(128),
  situation: z.string().max(10_000),
  presentationMinutes: z.number().min(0).max(180),
  qaMinutes: z.number().min(0).max(180),
  judges: z.array(JudgeIn).max(3),
  transcript: z.array(TranscriptIn).max(4000), // up to 60 + 60 min of speech
  qa: z.array(z.object({
    judge: JudgeIn,
    question: z.string().min(1).max(4000),
    answer: z.string().max(20_000),
    askedAt: z.number().nonnegative().optional(),
  })).max(60),
  docs: z.array(DocIn).min(1).max(2).refine(
    (docs) => new Set(docs.map((d) => d.role)).size === docs.length,
    "자료 역할은 중복될 수 없어요.",
  ),
  lint: z.array(LintIssueIn).max(200).optional(),
}) satisfies z.ZodType<ReportInput>;

export const ReportIn = z.object({
  session: ReportInputIn,
  provider: z.enum(["openai", "gemini", "claude"]).optional(),
});
