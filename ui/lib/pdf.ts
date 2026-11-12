// Client-only PDF helpers (pdfjs-dist v6). Loaded lazily so pdfjs never runs during SSR.
// Worker is served statically from /ui/pdf.worker.min.mjs (copied from node_modules/pdfjs-dist/build).
import type { PDFDocumentProxy } from "pdfjs-dist";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

export function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/ui/pdf.worker.min.mjs";
    return m;
  });
  return pdfjsPromise;
}

/** Open a PDF from a Blob/File or a URL. */
export async function openPdf(src: Blob | string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const data = typeof src === "string" ? undefined : new Uint8Array(await src.arrayBuffer());
  const task = pdfjs.getDocument(typeof src === "string" ? { url: src } : { data });
  return task.promise;
}

/** Read page count client-side. Throws if the file is not a readable PDF. */
export async function countPages(file: Blob): Promise<number> {
  const doc = await openPdf(file);
  const n = doc.numPages;
  void doc.loadingTask.destroy();
  return n;
}

/**
 * Render one page into a canvas, fitted inside cssWidth × maxCssHeight (CSS px, "contain") at devicePixelRatio.
 * The canvas gets explicit CSS width/height so portrait pages never grow past the height cap.
 */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number, maxCssHeight = Infinity, onTask?: (cancel: () => void) => void) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const fit = Math.min(cssWidth / base.width, maxCssHeight / base.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: fit * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(base.width * fit)}px`;
  canvas.style.height = `${Math.floor(base.height * fit)}px`;
  const task = page.render({ canvas, viewport });
  onTask?.(() => task.cancel());
  await task.promise;
  return { width: base.width, height: base.height, cssWidth: base.width * fit, cssHeight: base.height * fit };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
