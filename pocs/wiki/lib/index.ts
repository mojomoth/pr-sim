import "server-only";
// Public server API of the wiki PoC. See wiki/README.md for the contract.
import { listDocSummaries, listPages, readKeyNumbers, readMeta, readPage, readRawPage as readRaw } from "./store";
import { isRunning } from "./ingest";
import type { DocMeta, KeyNumber, WikiDocSummary, WikiPageInfo } from "./types";

export { ingestPdf, startIngest, reingest, deleteDoc, reverifyKeyNumbers, repairWiki, getWikiStatus, waitForWiki } from "./ingest";
export { queryWiki, saveAnswer } from "./query";
export { LlmUnavailableError, llmAvailable, probeLlm } from "./llm";
export { friendlyLlmError } from "./errors";
export { lintWiki } from "./lint";
export type * from "./types";

export async function listDocs(): Promise<WikiDocSummary[]> {
  // same stale-job rule as getWikiStatus: "in progress" on disk but no job in this process → interrupted
  return (await listDocSummaries()).map((d) => {
    if (d.state !== "ready" && d.state !== "error" && !isRunning(d.docId)) return { ...d, state: "error" as const, error: "중단됨 (서버 재시작 등)" };
    if (d.rebuilding && !isRunning(d.docId)) return { ...d, rebuilding: undefined, lastReingestError: "다시 만들기가 중단됐습니다 (서버 재시작 등). 지금 위키는 그대로입니다." };
    return d;
  });
}
export function getDocMeta(docId: string): Promise<DocMeta | null> {
  return readMeta(docId);
}
/** Content pages incl. overview / 주요-수치 / analysis pages (excludes index, log, SCHEMA). */
export function listWikiPages(docId: string): Promise<WikiPageInfo[]> {
  return listPages(docId);
}
/** Raw markdown (with frontmatter). Also reads "index", "log", "overview", "SCHEMA", "주요-수치". */
export function readWikiPage(docId: string, slug: string): Promise<string | null> {
  return readPage(docId, slug);
}
/** Immutable extracted text of one source page (1-based). */
export function readRawPage(docId: string, page: number): Promise<string | null> {
  return readRaw(docId, page);
}
export function getKeyNumbers(docId: string): Promise<KeyNumber[]> {
  return readKeyNumbers(docId);
}
