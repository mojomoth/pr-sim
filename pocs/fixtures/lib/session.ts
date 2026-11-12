// Runtime validator for SessionRecord (lib/types.ts). `satisfies` makes tsc fail if the schema drifts from the type.
// Only `import type` from "@/..." so this file also runs under plain Node (type stripping) in fixtures/tests.
import { z } from "zod";
import type { JudgePersona, QAItem, SessionRecord, TranscriptSentence } from "@/lib/types";

export const TemperamentSchema = z.enum(["friendly", "strict", "aggressive"]);

export const JudgePersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  temperament: TemperamentSchema,
  gender: z.enum(["male", "female"]).optional(),
  age: z.number().int().positive().optional(),
  imageUrl: z.string().optional(),
}) satisfies z.ZodType<JudgePersona>;

export const TranscriptSentenceSchema = z.object({
  t: z.number().nonnegative(),
  text: z.string().min(1),
  phase: z.enum(["presentation", "qa"]),
}) satisfies z.ZodType<TranscriptSentence>;

export const QAItemSchema = z.object({
  judge: JudgePersonaSchema.pick({ id: true, name: true, temperament: true }),
  question: z.string().min(1),
  answer: z.string(),
  askedAt: z.number().nonnegative().optional(),
}) satisfies z.ZodType<QAItem>;

export const SessionRecordSchema = z.object({
  id: z.string().min(1),
  situation: z.string(),
  presentationMinutes: z.number().positive(),
  qaMinutes: z.number().positive(),
  presentationDocId: z.string().optional(),
  proposalDocId: z.string().optional(),
  judges: z.array(JudgePersonaSchema),
  transcript: z.array(TranscriptSentenceSchema),
  qa: z.array(QAItemSchema),
  createdAt: z.string(),
}) satisfies z.ZodType<SessionRecord>;

export function parseSessionRecord(data: unknown): SessionRecord {
  return SessionRecordSchema.parse(data);
}
