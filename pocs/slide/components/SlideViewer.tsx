"use client";
// SlideViewer — swipeable PDF slide viewer (pdfjs-dist v6) for PR-SIM.
// Reusable: the real app's 발표 screen embeds this. See slide/README.md for the API.
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type Ref } from "react";
import { describePdfError, openPdf, type PdfSource, type PDFDocumentProxy, type RenderTask } from "../lib/pdf";
import {
  AXIS_LOCK_PX,
  SNAP_EASING,
  SNAP_MS,
  VelocityTracker,
  clampIndex,
  clampPan,
  decideRelease,
  dragOffset,
  fitContain,
  outputScale,
} from "../lib/swipe";

export interface SlideViewerHandle {
  /** 1-based page number. */
  goTo: (page: number) => void;
  next: () => void;
  prev: () => void;
  toggleFullscreen: () => void;
  /** Moves keyboard focus to the viewer (so ←/→/Space reach it in "focus" mode and never re-press a button). */
  focus: () => void;
  readonly page: number;
  readonly total: number;
}

export interface SlideLoadInfo {
  numPages: number;
  /** ms from src change to document metadata ready. */
  loadMs: number;
  /** First page size in PDF points (rotation applied). */
  pageWidth: number;
  pageHeight: number;
}

export interface SlideRenderInfo {
  page: number;
  /** ms spent in pdf.js render() for this canvas. */
  ms: number;
  /** ms since the current src started loading (first event ≈ time-to-first-page). */
  sinceOpenMs: number;
  workerRendering: boolean;
  /** device px per CSS px used for the canvas backing store. */
  outputScale: number;
  zoom: number;
}

export interface SlideViewerProps {
  src: PdfSource;
  /** 1-based page to show first. */
  initialPage?: number;
  /** Called with the 1-based page and page count whenever the visible page changes (and once after load). */
  onPageChange?: (page: number, total: number) => void;
  className?: string;
  /** Thumbnail strip under the controls (default true). */
  thumbnails?: boolean;
  /**
   * "focus" (default): keys work only while focus is inside the viewer (click/tap on it focuses it) — safe to embed
   * next to other controls or several viewers. "global": keys work anywhere on the page (ignored while typing or when
   * focus is inside another viewer). false: no keyboard.
   */
  keyboard?: "global" | "focus" | false;
  /**
   * Stage (viewport) aspect ratio. "first" (default): from page 1, so the stage never changes height while swiping.
   * "current": follows the current page, so a portrait page in a landscape deck is shown large (stage height changes).
   * number: fixed width/height ratio.
   */
  stageAspect?: "first" | "current" | number;
  /** Force main-thread rendering (pdf.js v6 renders in a worker by default). */
  disableWorkerRendering?: boolean;
  /** Accessible name of the viewer region. */
  label?: string;
  onLoad?: (info: SlideLoadInfo) => void;
  onRender?: (info: SlideRenderInfo) => void;
  onError?: (message: string, error: unknown) => void;
  ref?: Ref<SlideViewerHandle>;
}

type Size = { w: number; h: number };
type Zoom = { s: number; x: number; y: number };
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
/** Slots mounted around the current page; canvases are rendered for ±RENDER_AHEAD only. */
const MOUNT_AHEAD = 2;
const RENDER_AHEAD = 1;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** devicePixelRatio that follows browser zoom / moving the window between screens. */
function useDevicePixelRatio() {
  const [dpr, setDpr] = useState(1);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    const update = () => {
      setDpr(window.devicePixelRatio || 1);
      mq?.removeEventListener("change", update);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener("change", update);
    };
    update();
    return () => mq?.removeEventListener("change", update);
  }, []);
  return dpr;
}

/** Input types that don't take typed text / arrow keys: the viewer may handle ←/→ while they are focused. */
const NON_TEXT_INPUT = /^(checkbox|button|submit|reset|file|image|color)$/i;

/** Keys belong to the focused element (text fields, selects, radios, sliders…), not to the viewer. */
function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !NON_TEXT_INPUT.test((el as HTMLInputElement).type);
}

/** Space activates these natively (button press / checkbox toggle) — leave it to them. */
function isActivatable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "BUTTON" || el.tagName === "SUMMARY" || (el.tagName === "INPUT" && NON_TEXT_INPUT.test((el as HTMLInputElement).type));
}

/** Wheel stream gap that ends a trackpad gesture (incl. macOS momentum, ~16ms cadence). */
const WHEEL_IDLE_MS = 200;
/** Accumulated horizontal wheel px needed to turn one page. */
const WHEEL_TURN_PX = 60;

function releaseCanvas(c: HTMLCanvasElement) {
  c.remove();
  try {
    // Frees the backing store immediately (throws if control was transferred to a worker).
    c.width = 0;
    c.height = 0;
  } catch {
    /* OffscreenCanvas-backed: freed when GC'd / when the worker drops it */
  }
}

function isCancel(err: unknown) {
  return (err as { name?: string })?.name === "RenderingCancelledException";
}

// ─── Page canvas ────────────────────────────────────────────────────────────

interface PageCanvasProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** Slot (available area) size in CSS px. */
  box: Size;
  dpr: number;
  zoom: number;
  /** When false, never starts a render (keeps an existing canvas). */
  active: boolean;
  onSize: (index: number, size: Size) => void;
  onRendered: (info: Omit<SlideRenderInfo, "sinceOpenMs">) => void;
  onReleased: (index: number) => void;
  fit: Size;
}

function PageCanvas({ doc, pageNumber, box, dpr, zoom, active, onSize, onRendered, onReleased, fit }: PageCanvasProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const current = useRef<HTMLCanvasElement | null>(null);
  const renderedKey = useRef<string>("");
  const [state, setState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const cb = useRef({ onSize, onRendered, onReleased });
  useLayoutEffect(() => {
    cb.current = { onSize, onRendered, onReleased };
  });

  useEffect(() => {
    if (!active || box.w <= 0 || box.h <= 0) return;
    const key = `${box.w}x${box.h}@${dpr}z${zoom}`;
    if (renderedKey.current === key) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let next: HTMLCanvasElement | null = null;
    const run = async () => {
      try {
        setState((s) => (s === "done" ? s : "rendering"));
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        cb.current.onSize(pageNumber - 1, { w: base.width, h: base.height });
        const f = fitContain(base.width, base.height, box.w, box.h);
        if (!f.width) return;
        const os = outputScale(f.width, f.height, dpr, zoom);
        const viewport = page.getViewport({ scale: f.scale * os });
        const c = document.createElement("canvas");
        next = c;
        c.width = Math.max(1, Math.floor(viewport.width));
        c.height = Math.max(1, Math.floor(viewport.height));
        c.setAttribute("aria-hidden", "true");
        c.draggable = false;
        c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0";
        host.current?.appendChild(c);
        const t0 = performance.now();
        task = page.render({ canvas: c, viewport });
        await task.promise;
        if (cancelled) return;
        const ms = performance.now() - t0;
        c.style.opacity = "1";
        if (current.current && current.current !== c) releaseCanvas(current.current);
        current.current = c;
        next = null;
        renderedKey.current = key;
        setState("done");
        cb.current.onRendered({ page: pageNumber, ms, workerRendering: task.isWorkerRendering, outputScale: os, zoom });
      } catch (err) {
        if (cancelled || isCancel(err)) return;
        console.warn("[slide] render failed", pageNumber, err);
        setState("error");
      }
    };
    // First paint immediately; re-renders (resize / zoom / dpr) are debounced so we don't
    // thrash pdf.js while the user is still resizing or pinching. CSS scales the old canvas meanwhile.
    const timer = window.setTimeout(run, current.current ? 160 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
      if (next) releaseCanvas(next);
    };
  }, [doc, pageNumber, box.w, box.h, dpr, zoom, active]);

  // Memory cleanup when the slot leaves the mounted window.
  useEffect(
    () => () => {
      if (current.current) releaseCanvas(current.current);
      current.current = null;
      cb.current.onReleased(pageNumber - 1);
      void doc
        .getPage(pageNumber)
        .then((p) => p.cleanup())
        .catch(() => {});
    },
    [doc, pageNumber],
  );

  return (
    <div
      ref={host}
      data-page-host={pageNumber}
      data-render-state={state}
      className="relative bg-white will-change-transform"
      style={{ width: fit.w, height: fit.h, transformOrigin: "50% 50%" }}
    >
      {state !== "done" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-secondary tabular">
          {state === "error" ? "페이지를 그리지 못했어요" : <span className="animate-pulse">{pageNumber}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Thumbnails ─────────────────────────────────────────────────────────────

const THUMB_H = 52;

function Thumb({ doc, pageNumber, aspect, selected, enabled, onSelect, dpr }: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  aspect: number;
  selected: boolean;
  enabled: boolean;
  onSelect: (e: ReactMouseEvent) => void;
  dpr: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root: el.parentElement, rootMargin: "0px 200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!enabled || !visible || done) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let c: HTMLCanvasElement | null = null;
    thumbQueue = thumbQueue.then(async () => {
      if (cancelled) return;
      try {
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = (THUMB_H * dpr) / base.height;
        const vp = page.getViewport({ scale });
        c = document.createElement("canvas");
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        c.style.cssText = "width:100%;height:100%;display:block;object-fit:contain"; // other-aspect pages: no stretch
        c.setAttribute("aria-hidden", "true");
        ref.current?.querySelector("[data-thumb-host]")?.appendChild(c);
        task = page.render({ canvas: c, viewport: vp });
        await task.promise;
        if (!cancelled) setDone(true);
      } catch (err) {
        if (c) releaseCanvas(c);
        if (!isCancel(err) && !cancelled) console.warn("[slide] thumb failed", pageNumber, err);
      }
    });
    return () => {
      cancelled = true;
      if (!done) task?.cancel();
    };
  }, [enabled, visible, done, doc, pageNumber, dpr]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      aria-label={`${pageNumber}쪽으로 이동`}
      aria-current={selected ? "page" : undefined}
      data-thumb={pageNumber}
      className={`relative shrink-0 overflow-hidden rounded-[8px] bg-white outline-offset-2 transition-[outline-color,opacity] ${
        selected ? "outline-2 outline-ink opacity-100" : "outline-0 outline-transparent opacity-70 hover:opacity-100"
      }`}
      style={{ height: THUMB_H, width: Math.round(THUMB_H * aspect), outlineStyle: "solid" }}
    >
      <span data-thumb-host className="absolute inset-0" />
      {!done && <span className="absolute inset-0 flex items-center justify-center text-[11px] text-secondary tabular">{pageNumber}</span>}
    </button>
  );
}
/** Serialises thumbnail renders so they never compete with the visible page. */
let thumbQueue: Promise<void> = Promise.resolve();

// ─── Icons ──────────────────────────────────────────────────────────────────

const Icon = {
  left: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  right: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  ),
  expand: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  ),
  collapse: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  ),
};

// ─── Viewer ─────────────────────────────────────────────────────────────────

export function SlideViewer({
  src,
  initialPage = 1,
  onPageChange,
  className = "",
  thumbnails = true,
  keyboard = "focus",
  stageAspect = "first",
  disableWorkerRendering = false,
  label = "발표 슬라이드",
  onLoad,
  onRender,
  onError,
  ref,
}: SlideViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [index, setIndex] = useState(0);
  const [sizes, setSizes] = useState<Record<number, Size>>({});
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [fullscreen, setFullscreen] = useState(false);
  /** Pages whose canvas currently holds a finished render (0-based index → true). */
  const [rendered, setRendered] = useState<Record<number, boolean>>({});
  const primaryReady = !!rendered[index];
  const anyRendered = Object.keys(rendered).length > 0;
  const reducedMotion = usePrefersReducedMotion();
  const dpr = useDevicePixelRatio();

  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  const total = doc?.numPages ?? 0;

  const cbs = useRef({ onPageChange, onLoad, onRender, onError });
  useLayoutEffect(() => {
    cbs.current = { onPageChange, onLoad, onRender, onError };
  });

  // Reset per-document state when the source changes (render-time adjustment, no extra effect pass).
  const [loadedFor, setLoadedFor] = useState<{ src: PdfSource; main: boolean }>({ src, main: disableWorkerRendering });
  if (loadedFor.src !== src || loadedFor.main !== disableWorkerRendering) {
    setLoadedFor({ src, main: disableWorkerRendering });
    setStatus("loading");
    setError("");
    setProgress(0);
    setDoc(null);
    setSizes({});
    setRendered({});
    setZoom(NO_ZOOM);
  }

  // ── Load the document ──
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | null = null;
    openedAt.current = performance.now();
    (async () => {
      try {
        const task = await openPdf(src, {
          disableWorkerRendering,
          onProgress: (loaded, totalBytes) => !cancelled && totalBytes > 0 && setProgress(Math.min(1, loaded / totalBytes)),
        });
        destroy = () => task.destroy();
        if (cancelled) return void task.destroy();
        const d = await task.promise;
        if (cancelled) return;
        const first = await d.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setSizes({ 0: { w: vp.width, h: vp.height } });
        setIndex(clampIndex(initialPage - 1, d.numPages));
        setDoc(d);
        setStatus("ready");
        cbs.current.onLoad?.({ numPages: d.numPages, loadMs: performance.now() - openedAt.current, pageWidth: vp.width, pageHeight: vp.height });
      } catch (err) {
        if (cancelled) return;
        const msg = describePdfError(err);
        setStatus("error");
        setError(msg);
        cbs.current.onError?.(msg, err);
      }
    })();
    return () => {
      cancelled = true;
      void destroy?.();
    };
    // initialPage is only honoured when the source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, disableWorkerRendering]);

  // ── Stage size (ResizeObserver → re-render on resize / orientation change) ──
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      const h = Math.round(e.contentRect.height);
      setStage((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const firstSize = sizes[0] ?? { w: 16, h: 9 };
  /** Page-1 aspect: thumbnails, and the stage in "first" mode. */
  const aspect = firstSize.w / firstSize.h;
  const sizeOf = useCallback((i: number) => sizes[i] ?? sizes[0] ?? { w: 16, h: 9 }, [sizes]);
  const currentSize = sizeOf(index);
  const viewAspect =
    typeof stageAspect === "number" && stageAspect > 0
      ? stageAspect
      : stageAspect === "current"
        ? currentSize.w / currentSize.h
        : aspect;
  const onSize = useCallback((i: number, s: Size) => {
    setSizes((prev) => (prev[i] && prev[i].w === s.w && prev[i].h === s.h ? prev : { ...prev, [i]: s }));
  }, []);

  // ── Page change notifications ──
  useEffect(() => {
    if (status === "ready" && total > 0) cbs.current.onPageChange?.(index + 1, total);
  }, [index, total, status]);

  // ── Track position (direct DOM writes during drag → no React render per pointermove) ──
  const drag = useRef({ offset: 0, animate: false });
  const indexRef = useRef(index);
  const stageRef = useRef(stage);
  const zoomRef = useRef(zoom);
  useLayoutEffect(() => {
    indexRef.current = index;
    stageRef.current = stage;
    zoomRef.current = zoom;
  });
  const applyTrack = useCallback(
    (animate: boolean) => {
      const el = trackRef.current;
      if (!el) return;
      const x = -indexRef.current * stageRef.current.w + drag.current.offset;
      el.style.transition = animate && !reducedMotion ? `transform ${SNAP_MS}ms ${SNAP_EASING}` : "none";
      el.style.transform = `translate3d(${x}px,0,0)`;
    },
    [reducedMotion],
  );
  const prevStageW = useRef(stage.w);
  useLayoutEffect(() => {
    const resized = prevStageW.current !== stage.w;
    prevStageW.current = stage.w;
    applyTrack(drag.current.animate && !resized);
    drag.current.animate = false;
  }, [index, stage.w, applyTrack]);

  const applyZoom = useCallback((z: Zoom, animate = false) => {
    const el = trackRef.current?.querySelector<HTMLElement>(`[data-page-host="${indexRef.current + 1}"]`);
    if (!el) return;
    el.style.transition = animate ? `transform ${SNAP_MS}ms ${SNAP_EASING}` : "none";
    el.style.transform = z.s === 1 ? "" : `translate3d(${z.x}px,${z.y}px,0) scale(${z.s})`;
  }, []);

  const goTo = useCallback(
    (i: number, animate = true) => {
      if (!total) return;
      const target = clampIndex(i, total);
      drag.current.offset = 0;
      if (zoomRef.current.s !== 1) {
        applyZoom(NO_ZOOM);
        setZoom(NO_ZOOM);
      }
      if (target === indexRef.current) {
        applyTrack(animate);
        return;
      }
      drag.current.animate = animate;
      setIndex(target);
    },
    [total, applyTrack, applyZoom],
  );

  // ── Fullscreen (native when available, CSS overlay fallback e.g. iPhone Safari) ──
  // Side effects stay outside the state updater (updaters must be pure; StrictMode runs them twice).
  const fullscreenRef = useRef(false);
  const toggleFullscreen = useCallback(() => {
    const next = !fullscreenRef.current;
    fullscreenRef.current = next;
    const el = rootRef.current;
    if (next && el?.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    if (!next && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setFullscreen(next);
  }, []);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) {
        fullscreenRef.current = false;
        setFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  useImperativeHandle(
    ref,
    () => ({
      goTo: (p: number) => goTo(p - 1),
      next: () => goTo(indexRef.current + 1),
      prev: () => goTo(indexRef.current - 1),
      toggleFullscreen,
      focus: () => rootRef.current?.focus({ preventScroll: true }),
      get page() {
        return indexRef.current + 1;
      },
      get total() {
        return total;
      },
    }),
    [goTo, toggleFullscreen, total],
  );

  // ── Keyboard ──
  useEffect(() => {
    if (!keyboard) return;
    const target: HTMLElement | Window | null = keyboard === "global" ? window : rootRef.current;
    if (!target) return;
    const onKey = (ev: Event) => {
      const e = ev as KeyboardEvent;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      // Global mode: leave keys alone when focus is inside a different viewer (several viewers on one page).
      const owner = (e.target as Element | null)?.closest?.("[data-slide-viewer]");
      if (owner && owner !== rootRef.current) return;
      const i = indexRef.current;
      let handled = true;
      switch (e.key) {
        case "ArrowLeft":
        case "PageUp":
          goTo(i - 1);
          break;
        case "ArrowRight":
        case "PageDown":
          goTo(i + 1);
          break;
        case " ":
          if (isActivatable(e.target)) handled = false;
          else goTo(i + (e.shiftKey ? -1 : 1));
          break;
        case "Home":
          goTo(0);
          break;
        case "End":
          goTo(Number.MAX_SAFE_INTEGER);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          if (fullscreen) toggleFullscreen();
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [keyboard, goTo, toggleFullscreen, fullscreen]);

  // ── Pointer gestures: swipe (touch + mouse), flick, rubber-band, pinch, pan, double-tap ──
  const gesture = useRef<{
    mode: "idle" | "pending" | "swipe" | "scroll" | "pan" | "pinch";
    id: number;
    x0: number;
    y0: number;
    t0: number;
    zoom0: Zoom;
    dist0: number;
    mid0: { x: number; y: number };
    lastTap: { t: number; x: number; y: number };
    vel: VelocityTracker;
    pointers: Map<number, { x: number; y: number }>;
  }>({
    mode: "idle",
    id: -1,
    x0: 0,
    y0: 0,
    t0: 0,
    zoom0: NO_ZOOM,
    dist0: 1,
    mid0: { x: 0, y: 0 },
    lastTap: { t: 0, x: 0, y: 0 },
    vel: new VelocityTracker(),
    pointers: new Map(),
  });

  const wheelRef = useRef({ acc: 0, last: -Infinity, locked: false });

  const fitBox = useCallback((i: number) => {
    const s = sizeOf(i);
    const f = fitContain(s.w, s.h, stage.w, stage.h);
    return { w: f.width, h: f.height };
  }, [sizeOf, stage.w, stage.h]);

  const clampZoom = useCallback(
    (z: Zoom): Zoom => {
      const b = fitBox(indexRef.current);
      const s = Math.max(1, Math.min(MAX_ZOOM, z.s));
      return { s, x: clampPan(z.x, b.w, s), y: clampPan(z.y, b.h, s) };
    },
    [fitBox],
  );

  const commitZoom = useCallback(
    (z: Zoom, animate = true) => {
      const c = z.s < 1.05 ? NO_ZOOM : clampZoom(z);
      applyZoom(c, animate);
      setZoom(c);
    },
    [applyZoom, clampZoom],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || status !== "ready") return;
    const g = gesture.current;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
    };
    const pinchInfo = () => {
      const [a, b] = [...g.pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.pointerType === "mouse") e.preventDefault(); // no text selection / native drag (also blocks default focus)
      if (keyboard && rootRef.current && !rootRef.current.contains(document.activeElement)) {
        rootRef.current.focus({ preventScroll: true }); // keys follow the slide you touched (mouse preventDefault blocks native focus)
      }
      g.pointers.set(e.pointerId, local(e));
      if (g.pointers.size === 2) {
        // Second finger: abort any swipe and start pinch.
        if (g.mode === "swipe") {
          drag.current.offset = 0;
          applyTrack(true);
        }
        g.mode = "pinch";
        const p = pinchInfo();
        g.dist0 = p.dist;
        g.mid0 = p.mid;
        g.zoom0 = zoomRef.current;
        for (const id of g.pointers.keys()) el.setPointerCapture?.(id);
        return;
      }
      if (g.pointers.size > 2) return;
      g.mode = "pending";
      g.id = e.pointerId;
      g.x0 = e.clientX;
      g.y0 = e.clientY;
      g.t0 = e.timeStamp;
      g.zoom0 = zoomRef.current;
      g.vel.reset(e.clientX, e.timeStamp);
    };

    const move = (e: PointerEvent) => {
      if (!g.pointers.has(e.pointerId)) return;
      g.pointers.set(e.pointerId, local(e));
      if (g.mode === "pinch" && g.pointers.size >= 2) {
        const p = pinchInfo();
        const s = Math.max(0.8, Math.min(MAX_ZOOM, (g.zoom0.s * p.dist) / g.dist0));
        // Keep the content under the fingers' midpoint fixed while scaling.
        const k = s / g.zoom0.s;
        const x = p.mid.x - (g.mid0.x - g.zoom0.x) * k;
        const y = p.mid.y - (g.mid0.y - g.zoom0.y) * k;
        const z = { s, x, y };
        zoomRef.current = s < 1 ? { s, x: 0, y: 0 } : clampZoom(z);
        applyZoom(s < 1 ? { s, x: 0, y: 0 } : zoomRef.current);
        return;
      }
      if (e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      g.vel.push(e.clientX, e.timeStamp);
      if (g.mode === "pending") {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        if (zoomRef.current.s > 1) g.mode = "pan";
        else if (Math.abs(dx) > Math.abs(dy)) g.mode = "swipe";
        else g.mode = "scroll"; // let the page scroll vertically (touch-action: pan-y)
        if (g.mode !== "scroll") el.setPointerCapture?.(e.pointerId);
      }
      if (g.mode === "swipe") {
        drag.current.offset = dragOffset(dx, indexRef.current, total, stageRef.current.w);
        applyTrack(false);
      } else if (g.mode === "pan") {
        const z = clampZoom({ s: g.zoom0.s, x: g.zoom0.x + dx, y: g.zoom0.y + dy });
        zoomRef.current = z;
        applyZoom(z);
      }
    };

    const up = (e: PointerEvent) => {
      if (!g.pointers.has(e.pointerId)) return;
      // Touch pointers are implicitly captured by the child under the finger; moving capture to the
      // viewport fires a bubbling lostpointercapture from that child — that is NOT the end of the gesture.
      if (e.type === "lostpointercapture" && e.target !== el) return;
      g.pointers.delete(e.pointerId);
      const cancelled = e.type === "pointercancel";
      if (g.mode === "pinch") {
        if (g.pointers.size === 0) {
          g.mode = "idle";
          commitZoom(zoomRef.current);
        } else if (g.pointers.size === 1) {
          // One finger left: continue as pan from here — unless the pinch ended at (or below) 1×:
          // commit now (snaps < 1.05 back to NO_ZOOM) or the page would stay shrunk, since an
          // "idle" pointerup never commits.
          const [[id]] = [...g.pointers.entries()];
          g.id = id;
          if (zoomRef.current.s < 1.05) {
            commitZoom(zoomRef.current);
            g.mode = "idle";
            return;
          }
          g.mode = "pan";
          g.x0 = e.clientX;
          g.y0 = e.clientY;
          g.zoom0 = zoomRef.current;
          // Pan continues relative to the remaining finger position on its next move.
          const p = g.pointers.get(id)!;
          const r = el.getBoundingClientRect();
          g.x0 = p.x + r.left + r.width / 2;
          g.y0 = p.y + r.top + r.height / 2;
        }
        return;
      }
      if (e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (g.mode === "swipe") {
        const vx = cancelled ? 0 : g.vel.velocity(e.timeStamp);
        const target = cancelled ? indexRef.current : decideRelease({ dx, vx, width: stageRef.current.w, index: indexRef.current, total });
        drag.current.offset = 0;
        if (target === indexRef.current) applyTrack(true);
        else {
          drag.current.animate = true;
          setIndex(target);
        }
      } else if (g.mode === "pan") {
        commitZoom(zoomRef.current, false);
      } else if (g.mode === "pending" && !cancelled && Math.hypot(dx, dy) < AXIS_LOCK_PX && e.timeStamp - g.t0 < 350) {
        // Tap. Double-tap toggles zoom around the tapped point.
        const p = local(e);
        const last = g.lastTap;
        if (e.timeStamp - last.t < 320 && Math.hypot(p.x - last.x, p.y - last.y) < 40) {
          g.lastTap = { t: 0, x: 0, y: 0 };
          if (zoomRef.current.s > 1) commitZoom(NO_ZOOM);
          else commitZoom({ s: DOUBLE_TAP_ZOOM, x: -p.x * (DOUBLE_TAP_ZOOM - 1), y: -p.y * (DOUBLE_TAP_ZOOM - 1) });
        } else g.lastTap = { t: e.timeStamp, x: p.x, y: p.y };
      }
      g.mode = "idle";
      g.id = -1;
    };

    // Trackpad two-finger horizontal swipe / shift+wheel → page turn, exactly one page per gesture.
    // A gesture = a wheel stream without a WHEEL_IDLE_MS gap (finger phase + macOS momentum tail). After a
    // turn the rest of the stream is swallowed; the next stream (after the gap) can turn again. State lives
    // in a ref: this effect re-subscribes whenever page sizes become known, which must not reset the lock.
    const w = wheelRef.current;
    const wheel = (e: WheelEvent) => {
      if (zoomRef.current.s > 1) return;
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const now = e.timeStamp;
      const gap = now - w.last;
      // Any wheel activity over the slide (even a vertical-ish momentum sample) keeps the current gesture alive.
      if (horizontal || w.locked) w.last = now;
      if (!horizontal) return;
      e.preventDefault();
      if (gap > WHEEL_IDLE_MS) {
        w.acc = 0;
        w.locked = false;
      }
      if (w.locked) return;
      const px = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaMode === 2 ? e.deltaX * stageRef.current.w : e.deltaX;
      w.acc += px;
      if (Math.abs(w.acc) > WHEEL_TURN_PX) {
        goTo(indexRef.current + (w.acc > 0 ? 1 : -1));
        w.acc = 0;
        w.locked = true;
      }
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
      el.removeEventListener("wheel", wheel);
    };
  }, [status, total, applyTrack, applyZoom, clampZoom, commitZoom, goTo, keyboard]);

  // Re-apply zoom transform after the zoomed host re-mounts / page changes.
  useLayoutEffect(() => {
    applyZoom(zoom);
  }, [zoom, index, applyZoom]);

  // ── Rendering callbacks ──
  const handleRendered = useCallback(
    (info: Omit<SlideRenderInfo, "sinceOpenMs">) => {
      setRendered((r) => (r[info.page - 1] ? r : { ...r, [info.page - 1]: true }));
      cbs.current.onRender?.({ ...info, sinceOpenMs: performance.now() - openedAt.current });
    },
    [],
  );

  const handleReleased = useCallback((i: number) => {
    setRendered((r) => {
      if (!r[i]) return r;
      const n = { ...r };
      delete n[i];
      return n;
    });
  }, []);

  // Keep the current thumbnail in view.
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>(`[data-thumb="${index + 1}"]`);
    if (!strip || !el) return;
    const left = el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2;
    strip.scrollTo({ left, behavior: reducedMotion ? "auto" : "smooth" });
  }, [index, total, reducedMotion]);

  const mounted = useMemo(() => {
    if (!total) return [];
    const out: number[] = [];
    for (let i = Math.max(0, index - MOUNT_AHEAD); i <= Math.min(total - 1, index + MOUNT_AHEAD); i++) out.push(i);
    return out;
  }, [index, total]);

  /**
   * Pointer clicks on the viewer's own controls hand focus back to the viewer, so Space keeps meaning "next"
   * instead of re-pressing the clicked button (prev / fullscreen / thumbnail). Keyboard activation
   * (detail === 0) keeps focus on the button for keyboard-only users.
   */
  const refocus = (e: ReactMouseEvent) => {
    if (keyboard && e.detail > 0) rootRef.current?.focus({ preventScroll: true });
  };

  const page = index + 1;
  const atStart = index <= 0;
  const atEnd = index >= total - 1;
  const roundBtn =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed";

  return (
    <div
      ref={rootRef}
      data-slide-viewer
      role="region"
      aria-roledescription="슬라이드 뷰어"
      aria-label={label}
      tabIndex={keyboard === "focus" ? 0 : -1}
      data-state={status}
      data-page={status === "ready" ? page : 0}
      data-total={total}
      data-zoom={zoom.s.toFixed(2)}
      data-fullscreen={fullscreen ? "true" : "false"}
      className={
        fullscreen
          ? "fixed inset-0 z-[100] flex flex-col bg-ink p-[max(12px,env(safe-area-inset-top))_max(12px,env(safe-area-inset-right))_max(12px,env(safe-area-inset-bottom))_max(12px,env(safe-area-inset-left))] outline-none"
          : `flex flex-col gap-3 rounded-[28px] bg-card p-3 outline-none sm:p-4 ${className}`
      }
    >
      <div
        ref={viewportRef}
        data-slide-viewport
        className={`relative w-full select-none overflow-hidden ${fullscreen ? "min-h-0 flex-1" : "rounded-[16px]"}`}
        style={{
          aspectRatio: fullscreen ? undefined : `${viewAspect}`,
          maxHeight: fullscreen ? undefined : "var(--slide-max-h, min(68vh, 720px))",
          touchAction: zoom.s > 1 ? "none" : "pan-y",
          cursor: status === "ready" ? (zoom.s > 1 ? "move" : "grab") : undefined,
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
        }}
      >
        <div ref={trackRef} data-slide-track className="absolute inset-0" style={{ transform: "translate3d(0,0,0)" }}>
          {doc &&
            stage.w > 0 &&
            mounted.map((i) => {
              const fit = fitBox(i);
              const active = Math.abs(i - index) <= RENDER_AHEAD && (i === index || primaryReady);
              return (
                <div
                  key={i}
                  data-slide-index={i}
                  aria-hidden={i !== index}
                  className="absolute top-0 flex items-center justify-center"
                  style={{ left: i * stage.w, width: stage.w, height: stage.h }}
                >
                  <PageCanvas
                    doc={doc}
                    pageNumber={i + 1}
                    box={stage}
                    fit={fit}
                    dpr={dpr}
                    zoom={i === index ? zoom.s : 1}
                    active={active}
                    onSize={onSize}
                    onRendered={handleRendered}
                    onReleased={handleReleased}
                  />
                </div>
              );
            })}
        </div>
        {status !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" role={status === "error" ? "alert" : "status"}>
            {status === "loading" ? (
              <>
                <span className="h-1 w-32 overflow-hidden rounded-full bg-line">
                  <span className="block h-full bg-ink transition-[width] duration-200" style={{ width: `${Math.max(8, progress * 100)}%` }} />
                </span>
                <span className="text-sm font-medium text-secondary">PDF 불러오는 중…</span>
              </>
            ) : (
              <span className="text-sm font-medium text-error">{error}</span>
            )}
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {status === "ready" ? `${total}쪽 중 ${page}쪽` : ""}
        </span>
      </div>

      <div className={`flex items-center justify-center gap-3 ${fullscreen ? "pt-3" : ""}`}>
        <button
          type="button"
          onClick={(e) => {
            goTo(index - 1);
            refocus(e);
          }}
          disabled={status !== "ready" || atStart}
          aria-label="이전 슬라이드"
          data-action="prev"
          className={`${roundBtn} ${fullscreen ? "bg-white/15 text-white disabled:text-white/30" : "bg-ink text-inverse disabled:bg-line disabled:text-secondary"}`}
        >
          {Icon.left}
        </button>
        <span
          data-page-indicator
          className={`min-w-[72px] text-center text-[16px] font-semibold tabular ${fullscreen ? "text-white" : "text-ink"}`}
        >
          {status === "ready" ? `${page} / ${total}` : "– / –"}
        </span>
        <button
          type="button"
          onClick={(e) => {
            goTo(index + 1);
            refocus(e);
          }}
          disabled={status !== "ready" || atEnd}
          aria-label="다음 슬라이드"
          data-action="next"
          className={`${roundBtn} ${fullscreen ? "bg-white/15 text-white disabled:text-white/30" : "bg-ink text-inverse disabled:bg-line disabled:text-secondary"}`}
        >
          {Icon.right}
        </button>
        <span aria-hidden="true" className={`mx-1 h-6 w-px ${fullscreen ? "bg-white/25" : "bg-line"}`} />
        <button
          type="button"
          onClick={(e) => {
            toggleFullscreen();
            refocus(e);
          }}
          disabled={status !== "ready"}
          aria-label={fullscreen ? "전체 화면 닫기" : "전체 화면으로 보기"}
          aria-pressed={fullscreen}
          data-action="fullscreen"
          className={`${roundBtn} ${fullscreen ? "bg-white text-ink" : "bg-surface text-ink disabled:text-secondary"}`}
        >
          {fullscreen ? Icon.collapse : Icon.expand}
        </button>
      </div>

      {thumbnails && doc && !fullscreen && total > 1 && (
        <div
          ref={stripRef}
          data-thumb-strip
          className="flex gap-2 overflow-x-auto px-1 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="슬라이드 목록"
        >
          {Array.from({ length: total }, (_, i) => (
            <Thumb
              key={i}
              doc={doc}
              pageNumber={i + 1}
              aspect={aspect}
              selected={i === index}
              enabled={anyRendered}
              dpr={dpr}
              onSelect={(e) => {
                goTo(i, Math.abs(i - index) <= 1);
                refocus(e);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default SlideViewer;
