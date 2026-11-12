import "server-only";
import { z } from "zod";
import { ApiError } from "../http";
import type { DocInput } from "../types";

// Request validation shared by /api/wiki, /api/questions and /api/report.

export const MAX_PAGES = 120;
export const MAX_CHARS = 150_000;

const PAGE_TYPES = ["overview", "entity", "concept", "topic", "numbers", "analysis", "meta"] as const;

export const WikiPageIn = z.object({
  slug: z.string().min(1).max(120),
  title: z.string().max(200),
  type: z.enum(PAGE_TYPES),
  summary: z.string().max(1000),
  sources: z.array(z.number().int().min(1).max(10_000)).max(500),
  markdown: z.string().max(60_000),
});

export const KeyNumberIn = z.object({
  metric: z.string().max(200),
  value: z.string().max(200),
  pages: z.array(z.number().int().min(1).max(10_000)).max(100),
  note: z.string().max(1000),
  conflict: z.boolean(),
  unverified: z.array(z.number().int()).max(100).optional(),
});

export const DocIn = z.object({
  role: z.enum(["presentation", "proposal"]),
  docId: z.string().regex(/^[a-f0-9]{16}$/),
  filename: z.string().min(1).max(200),
  pageTexts: z.array(z.string().max(MAX_CHARS)).min(1).max(1000),
  wiki: z.array(WikiPageIn).max(200).optional(),
  keyNumbers: z.array(KeyNumberIn).max(500).optional(),
}) satisfies z.ZodType<DocInput>;

// t = seconds since the phase started; presentationMinutes/qaMinutes allow up to 180 min, so 6 h leaves room for overrun.
const MAX_TRANSCRIPT_T = 6 * 3600;

export const TranscriptIn = z.object({
  id: z.string().min(1).max(64),
  t: z.number().nonnegative().max(MAX_TRANSCRIPT_T),
  text: z.string().min(1).max(2000),
  phase: z.enum(["presentation", "qa"]),
  slide: z.number().int().min(1).optional(),
});

/** Page/char caps (413) and scanned-PDF check (422: fewer than 30 % of pages carry text). */
export function checkDocLimits(doc: DocInput) {
  const chars = doc.pageTexts.reduce((a, t) => a + t.length, 0);
  if (doc.pageTexts.length > MAX_PAGES || chars > MAX_CHARS) throw new ApiError("too_large");
  const withText = doc.pageTexts.filter((t) => t.replace(/\s/g, "").length >= 20).length;
  if (withText < doc.pageTexts.length * 0.3 || chars < 50) throw new ApiError("unsupported", "텍스트가 없는 PDF(스캔본)는 아직 지원하지 않아요.");
}
