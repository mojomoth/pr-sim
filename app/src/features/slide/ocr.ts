// OCR for PDFs without a text layer: render the empty pages with pdf.js, send them to /api/ocr in batches,
// and fill the returned text into PdfInfo. Client-only.
import { postOcr } from "@/features/session/api";
import { OCR_BATCH } from "@/server/types";
import { EMPTY_PAGE_CHARS, openPdf, type PdfInfo } from "./pdf";

/** Long side of the rendered page. 1600px keeps small slide text legible at ~150–300KB JPEG. */
const MAX_SIDE = 1600;
const PARALLEL = 3;

/** Too little text to work with (same rule as the wiki route's 422): needs OCR. */
export function needsOcr(info: Pick<PdfInfo, "pageCount" | "pageTexts" | "emptyPages">): boolean {
  const chars = info.pageTexts.reduce((a, t) => a + t.length, 0);
  return info.pageCount - info.emptyPages.length < info.pageCount * 0.3 || chars < 50;
}

async function toBase64Jpeg(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  if (!blob) throw new Error("쪽 이미지를 만들지 못했어요. 다시 시도해 주세요.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Read the text of `info.emptyPages` from their images. Returns a new PdfInfo; `onProgress` counts pages. */
export async function ocrEmptyPages(file: Blob, info: PdfInfo, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<PdfInfo> {
  const pages = info.emptyPages;
  if (!pages.length) return info;
  const task = await openPdf(file);
  const texts = [...info.pageTexts];
  let done = 0;
  try {
    const doc = await task.promise;
    const render = async (n: number) => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, MAX_SIDE / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      try {
        await page.render({ canvas, viewport, background: "#ffffff" }).promise;
        return { page: n, image: await toBase64Jpeg(canvas) };
      } finally {
        canvas.width = canvas.height = 0; // free the backing store (iOS caps total canvas memory)
        page.cleanup();
      }
    };
    const batches: number[][] = [];
    for (let i = 0; i < pages.length; i += OCR_BATCH) batches.push(pages.slice(i, i + OCR_BATCH));
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const images = [];
        for (const n of batch) images.push(await render(n)); // sequential: one canvas at a time per worker
        const res = await postOcr(images, signal);
        for (const p of res.pages) texts[p.page - 1] = p.text;
        done += batch.length;
        onProgress?.(done, pages.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
  } finally {
    void task.destroy();
  }
  return {
    ...info,
    pageTexts: texts,
    emptyPages: texts.map((t, i) => (t.replace(/\s/g, "").length < EMPTY_PAGE_CHARS ? i + 1 : 0)).filter(Boolean),
  };
}
