// Client-only pdf.js (pdfjs-dist v6): loading, upload validation, per-page text extraction, docId.
// - The library is bundled (dynamic import → separate chunk, never in the SSR path).
// - Worker / renderer worker / cmaps / fonts / wasm are static files in /public/pdfjs/
//   (copied by ./sync-pdfjs.mjs), so no bundler-specific worker handling is needed.
import type * as PdfjsLib from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { MAX_DOC_PAGES } from "@/server/types";

export type { PDFDocumentProxy, RenderTask };

/** Anything the viewer accepts: an uploaded File/Blob, raw bytes, or a URL. */
export type PdfSource = File | Blob | ArrayBuffer | Uint8Array | string;

const PDFJS_ASSET_BASE = "/pdfjs/";

/** Upload limits (client; the server re-checks text length). */
export const PDF_LIMITS = {
  maxBytes: 30 * 1024 * 1024,
  maxPages: MAX_DOC_PAGES,
} as const;

/** A page with fewer non-space characters than this counts as empty (scanned image, picture-only slide). */
export const EMPTY_PAGE_CHARS = 20;

let libPromise: Promise<typeof PdfjsLib> | null = null;

/** Load pdf.js once per page and configure its workers. */
function loadPdfjs(): Promise<typeof PdfjsLib> {
  if (!libPromise) {
    libPromise = import("pdfjs-dist")
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSET_BASE}pdf.worker.min.mjs`;
        // v6: pages can be rasterised in a dedicated renderer worker (OffscreenCanvas).
        lib.GlobalWorkerOptions.rendererSrc = `${PDFJS_ASSET_BASE}pdf.renderer.min.mjs`;
        return lib;
      })
      .catch((err) => {
        libPromise = null;
        throw err;
      });
  }
  return libPromise;
}

/** Start loading a PDF. Caller owns the task: `await task.promise`, `task.destroy()` on cleanup. */
export async function openPdf(src: PdfSource, opts: { onProgress?: (loaded: number, total: number) => void } = {}): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await loadPdfjs();
  let source: { url: string } | { data: Uint8Array };
  if (typeof src === "string") source = { url: src };
  else if (src instanceof Blob) source = { data: new Uint8Array(await src.arrayBuffer()) };
  // pdf.js transfers (detaches) the buffer to its worker — copy so the caller's bytes survive.
  else if (src instanceof ArrayBuffer) source = { data: new Uint8Array(src.slice(0)) };
  else source = { data: src.slice() };

  const task = pdfjs.getDocument({
    ...source,
    cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
    // URL sources: fetch the first page via HTTP range requests, stream the rest in background.
    rangeChunkSize: 128 * 1024,
  });
  if (opts.onProgress) task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => opts.onProgress?.(loaded, total);
  return task;
}

/** Korean message for the common pdf.js failures. */
export function describePdfError(err: unknown): string {
  if (err instanceof PdfError) return err.message;
  const name = (err as { name?: string })?.name ?? "";
  if (name === "PasswordException") return "암호가 걸린 PDF는 열 수 없어요. 암호를 해제한 파일을 올려 주세요.";
  if (name === "InvalidPDFException") return "PDF 파일을 읽을 수 없어요. 파일이 손상됐거나 PDF 형식이 아니에요.";
  if (name === "ResponseException" || name === "MissingPDFException") return "PDF를 불러오지 못했어요. 네트워크 연결을 확인해 주세요.";
  return "PDF를 여는 중에 문제가 생겼어요. 다시 시도해 주세요.";
}

class PdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfError";
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** "%PDF-" within the first 1024 bytes (the spec tolerates leading junk). */
function hasPdfMagic(head: Uint8Array): boolean {
  const s = String.fromCharCode(...head.subarray(0, 1024));
  return s.includes("%PDF-");
}

/** Cheap checks before parsing: type, size, magic bytes. Throws PdfError. Returns the bytes. (Exported for tests.) */
export async function checkFile(file: Blob): Promise<Uint8Array> {
  const name = file instanceof File ? file.name : "";
  const typeOk = !file.type || file.type === "application/pdf" || file.type === "application/octet-stream" || /\.pdf$/i.test(name);
  if (!typeOk) throw new PdfError("PDF 파일만 올릴 수 있어요.");
  if (file.size === 0) throw new PdfError("빈 파일이에요. 내용이 있는 PDF를 올려 주세요.");
  if (file.size > PDF_LIMITS.maxBytes) {
    throw new PdfError(`파일이 너무 커요(${formatBytes(file.size)}). ${formatBytes(PDF_LIMITS.maxBytes)} 이하 PDF만 올릴 수 있어요.`);
  }
  const data = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfMagic(data)) throw new PdfError("PDF 파일만 올릴 수 있어요. 다른 형식의 파일은 PDF로 저장한 뒤 올려 주세요.");
  return data;
}

/** Validate + open. Caller destroys `doc` (doc.loadingTask.destroy()). */
async function openValidated(file: Blob): Promise<{ doc: PDFDocumentProxy; data: Uint8Array }> {
  const data = await checkFile(file);
  const task = await openPdf(data);
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    void task.destroy();
    throw new PdfError(describePdfError(e));
  }
  if (doc.numPages < 1) {
    void task.destroy();
    throw new PdfError("쪽이 없는 PDF예요. 다른 파일을 올려 주세요.");
  }
  if (doc.numPages > PDF_LIMITS.maxPages) {
    const n = doc.numPages;
    void task.destroy();
    throw new PdfError(`쪽수가 너무 많아요(${n}쪽). ${PDF_LIMITS.maxPages}쪽 이하 PDF만 올릴 수 있어요.`);
  }
  return { doc, data };
}

/** Per-page text (index 0 = p.1), whitespace-normalised. Same joining as unpdf (item.str + EOL). */
async function extractPageTexts(doc: PDFDocumentProxy, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let s = "";
    for (const item of content.items) {
      if ("str" in item) s += item.str + (item.hasEOL ? "\n" : "");
    }
    out.push(
      s
        .replace(/[ \t ]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }
  return out;
}

/** docId = first 16 hex chars of sha256(PDF bytes). Needs a secure context (HTTPS / localhost). */
export async function pdfDocId(data: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new PdfError("보안 연결(HTTPS)에서만 자료를 올릴 수 있어요.");
  const hash = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(hash)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface PdfInfo {
  docId: string;
  bytes: number;
  pageCount: number;
  pageTexts: string[];
  /** 1-based pages with (almost) no text. */
  emptyPages: number[];
}

/** Everything the setup screen stores for an upload: validate → docId → page texts. Throws PdfError. */
export async function readPdf(file: Blob, onProgress?: (done: number, total: number) => void): Promise<PdfInfo> {
  const { doc, data } = await openValidated(file);
  try {
    const [docId, pageTexts] = await Promise.all([pdfDocId(data), extractPageTexts(doc, onProgress)]);
    return {
      docId,
      bytes: file.size,
      pageCount: doc.numPages,
      pageTexts,
      emptyPages: pageTexts.map((t, i) => (t.replace(/\s/g, "").length < EMPTY_PAGE_CHARS ? i + 1 : 0)).filter(Boolean),
    };
  } catch (e) {
    throw e instanceof PdfError ? e : new PdfError(describePdfError(e));
  } finally {
    void doc.loadingTask.destroy();
  }
}
