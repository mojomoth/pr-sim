// Client-only pdf.js (pdfjs-dist v6) loader for the slide viewer.
// - The library itself is bundled (dynamic import → separate chunk, never in the SSR path).
// - Worker / renderer-worker / cmaps / fonts / wasm are served as static files from
//   /slide/pdfjs/ (copied by slide/scripts/sync-pdfjs.mjs), so no bundler-specific worker
//   handling is needed and no "fake worker" fallback ever kicks in.
import type * as PdfjsLib from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

export type Pdfjs = typeof PdfjsLib;
export type { PDFDocumentProxy, PDFPageProxy, RenderTask };

/** Anything the viewer accepts: an uploaded File/Blob, raw bytes, or a URL. */
export type PdfSource = File | Blob | ArrayBuffer | Uint8Array | string;

export const PDFJS_ASSET_BASE = "/slide/pdfjs/";

let libPromise: Promise<Pdfjs> | null = null;

/** Load pdf.js once per page and configure its workers. */
export function loadPdfjs(): Promise<Pdfjs> {
  if (!libPromise) {
    libPromise = import("pdfjs-dist")
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSET_BASE}pdf.worker.min.mjs`;
        // v6: pages can be rasterised in a dedicated renderer worker (OffscreenCanvas),
        // keeping the main thread free while the user is swiping.
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

export interface OpenOptions {
  /** Render on the main thread instead of the v6 renderer worker. */
  disableWorkerRendering?: boolean;
  onProgress?: (loaded: number, total: number) => void;
}

/** Start loading a PDF. Caller owns the task: `await task.promise`, `task.destroy()` on cleanup. */
export async function openPdf(src: PdfSource, opts: OpenOptions = {}): Promise<PDFDocumentLoadingTask> {
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
    disableWorkerRendering: opts.disableWorkerRendering ?? false,
    // URL sources: fetch the first page via HTTP range requests, stream the rest in background.
    rangeChunkSize: 128 * 1024,
  });
  if (opts.onProgress) task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => opts.onProgress?.(loaded, total);
  return task;
}

/** Human-readable Korean error for the common pdf.js failures. */
export function describePdfError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "PasswordException") return "암호로 보호된 PDF는 열 수 없어요.";
  if (name === "InvalidPDFException") return "PDF 파일을 읽을 수 없어요. 손상되었거나 PDF 형식이 아니에요.";
  if (name === "ResponseException" || name === "MissingPDFException") return "PDF를 불러오지 못했어요. 주소나 네트워크를 확인해 주세요.";
  return "PDF를 여는 중 문제가 생겼어요. 다시 시도해 주세요.";
}

/** Same as pdfjs `isPdfFile` + MIME check, for upload validation. */
export function looksLikePdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
