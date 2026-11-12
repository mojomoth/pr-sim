"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getFileBlob, getUiState } from "../lib/store";
import { openPdf, renderPage } from "../lib/pdf";
import { MOCK_SLIDES } from "../lib/mock";
import { ChevronLeft, ChevronRight, Close, Expand } from "./Icons";

export type DeckSource = { kind: "loading" } | { kind: "pdf"; doc: PDFDocumentProxy; origin: "upload" | "sample" | "fixture" } | { kind: "mock" };

/** Resolve the deck: uploaded or sample PDF blob (in-memory) → fixtures/presentation.pdf via /api/ui/fixture → mock slides. */
export function useDeck(): DeckSource {
  const [src, setSrc] = useState<DeckSource>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    (async () => {
      const blob = getFileBlob("presentation");
      try {
        if (blob) {
          doc = await openPdf(blob);
          const origin = getUiState().files.presentation?.sample ? "sample" : "upload";
          if (!cancelled) setSrc({ kind: "pdf", doc, origin });
          return;
        }
        const check = (await fetch("/api/ui/fixture?slot=presentation&check=1").then((r) => r.json())) as { exists: boolean };
        if (check.exists) {
          doc = await openPdf("/api/ui/fixture?slot=presentation");
          if (!cancelled) setSrc({ kind: "pdf", doc, origin: "fixture" });
          return;
        }
      } catch {
        /* fall through to mock */
      }
      if (!cancelled) setSrc({ kind: "mock" });
    })();
    return () => {
      cancelled = true;
      void doc?.loadingTask.destroy();
    };
  }, []);
  return src;
}

export function deckPageCount(src: DeckSource) {
  return src.kind === "pdf" ? src.doc.numPages : src.kind === "mock" ? MOCK_SLIDES.length : 0;
}

/**
 * Canvas that renders one PDF page "contain"-fitted into its box:
 * width = container width, height cap = the box's computed max-height (CSS var --slide-max-h).
 * Portrait pages are letterboxed (centered) instead of growing the stage past the viewport.
 */
function PdfPage({ doc, page }: { doc: PDFDocumentProxy; page: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: Infinity });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      const mh = parseFloat(getComputedStyle(el).maxHeight);
      const h = Number.isFinite(mh) && mh > 0 ? Math.round(mh) : Infinity;
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    if (!box.w || !canvas.current) return;
    const c = canvas.current;
    let cancel: (() => void) | undefined;
    let cancelled = false;
    renderPage(doc, page, c, box.w, box.h, (fn) => (cancel = fn))
      .then(() => {
        if (!cancelled) c.style.opacity = "1";
      })
      .catch((e: unknown) => {
        if (!cancelled && (e as { name?: string })?.name !== "RenderingCancelledException") c.style.opacity = "0.3";
      });
    return () => {
      cancelled = true;
      cancel?.();
    };
  }, [doc, page, box]);
  return (
    <div ref={wrap} className="flex w-full justify-center [max-height:var(--slide-max-h,none)]" data-testid="pdf-page">
      <canvas ref={canvas} className="block max-w-full rounded-[8px] bg-canvas" role="img" aria-label={`슬라이드 ${page}`} />
    </div>
  );
}

/** HTML placeholder slide (16:9) used when no PDF is available. Scales via container units. */
export function MockSlide({ index }: { index: number }) {
  const s = MOCK_SLIDES[(index - 1) % MOCK_SLIDES.length];
  return (
    <div className="@container relative aspect-video w-full overflow-hidden bg-canvas" role="img" aria-label={`슬라이드 ${index}: ${s.title}`}>
      <div className="absolute inset-0 flex p-[6cqw]">
        <div className="flex w-[55%] flex-col">
          <p className="text-[2.6cqw] font-medium text-secondary">{String(index).padStart(2, "0")}</p>
          <p className="mt-[1.5cqw] text-[6.2cqw] font-bold leading-[1.15] tracking-[-0.03em] text-ink">{s.title}</p>
          <p className="mt-[1.5cqw] text-[2.9cqw] text-secondary">{s.sub}</p>
          {s.kind === "bars" && (
            <div className="mt-auto flex h-[24cqw] items-end gap-[2.2cqw] border-b-[0.35cqw] border-l-[0.35cqw] border-ink/70 pb-0 pl-[2cqw]">
              {[28, 42, 60, 82].map((h, i) => (
                <span key={i} className="w-[5cqw] bg-ink/80" style={{ height: `${h}%` }} />
              ))}
            </div>
          )}
          {s.kind === "points" && (
            <ul className="mt-auto flex flex-col gap-[1.4cqw] text-[2.7cqw] text-ink">
              {["핵심 근거 하나", "숫자로 말하기", "다음 단계"].map((t) => (
                <li key={t} className="flex items-center gap-[1.4cqw]">
                  <span className="h-[1.2cqw] w-[1.2cqw] rounded-full bg-ink" />
                  {t}
                </li>
              ))}
            </ul>
          )}
          {s.kind === "number" && <p className="mt-auto text-[11cqw] font-bold leading-none tracking-[-0.04em]">{index === 2 ? "31만t" : index === 5 ? "90%" : "×3"}</p>}
        </div>
        <div className="ml-auto flex w-[38%] items-center justify-center">
          <div className="relative h-[32cqw] w-full">
            <div className="absolute bottom-0 left-[4%] h-[18cqw] w-[45%] rounded-[1cqw] bg-card" />
            <div className="absolute bottom-0 right-[6%] h-[30cqw] w-[44%] rounded-[1.6cqw] bg-surface ring-[0.3cqw] ring-line" />
            <div className="absolute bottom-[8cqw] right-[20%] h-[5cqw] w-[5cqw] rounded-full border-[0.4cqw] border-ink/60" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * PDF stage: keeps original aspect ratio, prev/next buttons, swipe, keyboard arrows,
 * "3 / 12" counter and fullscreen view. `overlay` renders over the lower-right (camera inset).
 */
export function SlideStage({ src, page, onPage, overlay }: { src: DeckSource; page: number; onPage: (p: number) => void; overlay?: React.ReactNode }) {
  const total = deckPageCount(src);
  const [full, setFull] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const go = useCallback((d: number) => total && onPage(Math.min(total, Math.max(1, page + d))), [onPage, page, total]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, go]);

  const swipe = {
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
    },
  };

  const slide =
    src.kind === "pdf" ? (
      <PdfPage doc={src.doc} page={page} />
    ) : src.kind === "mock" ? (
      <MockSlide index={page} />
    ) : (
      <div className="aspect-video w-full animate-pulse bg-canvas" aria-label="슬라이드 불러오는 중" />
    );

  const nav = (dark?: boolean) => (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => go(-1)} disabled={page <= 1} aria-label="이전 슬라이드" className={`inline-flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-35 ${dark ? "bg-inverse/15 text-inverse" : "bg-canvas"}`}>
        <ChevronLeft size={20} />
      </button>
      <span className={`min-w-[64px] text-center text-[16px] font-semibold tabular ${dark ? "text-inverse" : ""}`} aria-live="polite" data-testid="slide-counter">
        {total ? `${page} / ${total}` : "– / –"}
      </span>
      <button type="button" onClick={() => go(1)} disabled={!total || page >= total} aria-label="다음 슬라이드" className={`inline-flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-35 ${dark ? "bg-inverse/15 text-inverse" : "bg-canvas"}`}>
        <ChevronRight size={20} />
      </button>
    </div>
  );

  return (
    <section aria-label="발표 자료" className="relative rounded-[28px] bg-card p-3 pb-2 sm:p-4 sm:pb-3">
      <div
        className="relative touch-pan-y select-none overflow-hidden rounded-[12px] outline-none"
        tabIndex={0}
        aria-roledescription="슬라이드"
        aria-label="발표 슬라이드 — 좌우 화살표 키 또는 스와이프로 이동"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
        {...swipe}
      >
        {slide}
      </div>
      {overlay}
      <div className="mt-2 flex items-center justify-between pl-1">
        {nav()}
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-secondary">
            {src.kind === "pdf" ? (src.origin === "upload" ? "업로드 PDF" : "샘플 PDF") : src.kind === "mock" ? "예시 슬라이드" : ""}
          </span>
          <span className="h-5 w-px bg-line" aria-hidden="true" />
          <button type="button" onClick={() => setFull(true)} aria-label="슬라이드 크게 보기" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-canvas">
            <Expand size={18} />
          </button>
        </div>
      </div>

      {full &&
        createPortal(
        <div role="dialog" aria-modal="true" aria-label="슬라이드 크게 보기" className="ui-fade fixed inset-0 z-50 flex flex-col bg-ink">
          <div className="flex h-14 items-center justify-end px-3">
            <button type="button" autoFocus onClick={() => setFull(false)} aria-label="크게 보기 닫기" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-inverse/15 text-inverse">
              <Close size={22} />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center px-3" {...swipe}>
            <div className="w-full max-w-[min(1200px,calc((100dvh-140px)*16/9))] touch-pan-y select-none overflow-hidden rounded-[8px] [--slide-max-h:calc(100dvh-140px)]">{slide}</div>
          </div>
          <div className="flex justify-center pb-6 pt-3">{nav(true)}</div>
        </div>,
          document.body,
        )}
    </section>
  );
}
