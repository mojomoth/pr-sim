import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDocId } from "./store";

export const SAMPLES = {
  presentation: { file: path.join(process.cwd(), "fixtures", "presentation.pdf"), filename: "presentation.pdf", kind: "presentation" as const },
  proposal: { file: path.join(process.cwd(), "fixtures", "proposal.pdf"), filename: "proposal.pdf", kind: "proposal" as const },
  large: { file: path.join(process.cwd(), "wiki", "fixtures", "large-128p.pdf"), filename: "large-128p.pdf", kind: "proposal" as const },
};
export type SampleKey = keyof typeof SAMPLES;
export const isSample = (s: unknown): s is SampleKey => typeof s === "string" && s in SAMPLES;
export const readSample = (k: SampleKey) => readFile(SAMPLES[k].file);

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Validates the dynamic docId param; returns the id or a 400 response. */
export async function docParam(params: Promise<{ docId: string }>): Promise<string | Response> {
  const { docId } = await params;
  return isDocId(docId) ? docId : jsonError(400, "invalid docId");
}

export function errorStatus(e: unknown): number {
  const m = e instanceof Error ? e.message : "";
  if (/unknown docId|원본 PDF가 저장되지/.test(m)) return 404;
  if (/not ready/.test(m)) return 409;
  if (/empty|invalid|PDF 파일이 아닙니다|FormData|Unexpected end of JSON|query\/answer/i.test(m)) return 400;
  if (e instanceof Error && e.name === "LlmUnavailableError") return 503;
  return 500;
}
export function errorResponse(e: unknown) {
  return jsonError(errorStatus(e), e instanceof Error ? e.message : String(e));
}
