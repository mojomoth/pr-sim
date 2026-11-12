"use client";
// /slide — PoC page around <SlideViewer>: upload / drag&drop / sample PDFs + live metrics for HIL.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SlideViewer, type SlideLoadInfo, type SlideRenderInfo, type SlideViewerHandle } from "./SlideViewer";
import { looksLikePdf, MAX_UPLOAD_BYTES, type PdfSource } from "../lib/pdf";

/** nonce changes on every pick → the viewer remounts (page 1, fresh load metrics) even for the same sample URL. */
type Picked = { src: PdfSource; name: string; bytes?: number; kind: "upload" | "sample"; nonce: number };
let pickSeq = 0;

const SAMPLES = [
  { key: "presentation", title: "샘플 발표자료", desc: "16:9 피치덱 · 12장" },
  { key: "proposal", title: "샘플 제안자료", desc: "A4 사업계획서 · 58쪽" },
] as const;

function fmtBytes(n?: number) {
  if (n == null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  const mb = n / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}
const ms = (n?: number) => (n == null ? "–" : `${Math.round(n)}ms`);

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
    </svg>
  );
}

export function SlidePage() {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [mainThread, setMainThread] = useState(false);
  const [page, setPage] = useState<{ p: number; total: number } | null>(null);
  const [load, setLoad] = useState<SlideLoadInfo | null>(null);
  const [firstPaint, setFirstPaint] = useState<number | null>(null);
  const [lastRender, setLastRender] = useState<SlideRenderInfo | null>(null);
  const [renderCount, setRenderCount] = useState(0);
  const [viewerError, setViewerError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const viewer = useRef<SlideViewerHandle>(null);
  const dragDepth = useRef(0);

  const reset = () => {
    setPage(null);
    setLoad(null);
    setFirstPaint(null);
    setLastRender(null);
    setRenderCount(0);
    setViewerError("");
  };

  const pickFile = useCallback((file: File | undefined | null) => {
    if (!file) return;
    if (!looksLikePdf(file)) return setUploadError("PDF 파일만 올릴 수 있어요.");
    if (file.size > MAX_UPLOAD_BYTES) return setUploadError(`파일이 너무 커요. ${fmtBytes(MAX_UPLOAD_BYTES)} 이하로 올려 주세요.`);
    setUploadError("");
    reset();
    setPicked({ src: file, name: file.name, bytes: file.size, kind: "upload", nonce: ++pickSeq });
  }, []);

  const pickSample = useCallback((key: string) => {
    const s = SAMPLES.find((x) => x.key === key);
    if (!s) return;
    setUploadError("");
    reset();
    // Re-picking the active sample restarts it from page 1 and re-measures (fresh mount via nonce).
    setPicked({ src: `/api/slide/sample/${s.key}`, name: s.title, kind: "sample", nonce: ++pickSeq });
  }, []);

  // After a pick (or the renderer toggle, which remounts the viewer), hand focus to the viewer:
  // Space/←/→ then turn slides instead of re-pressing the sample button / re-toggling the checkbox.
  useEffect(() => {
    if (picked) viewer.current?.focus();
  }, [picked, mainThread]);

  // ?sample=presentation|proposal → autoload (shareable HIL links, tests). ?main=1 → main-thread rendering.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("sample");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the URL on mount
    if (q.get("main") === "1") setMainThread(true);
    if (s) pickSample(s);
  }, [pickSample]);

  // Drop a PDF anywhere on the page.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      pickFile(e.dataTransfer?.files?.[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [pickFile]);

  const onRender = useCallback((info: SlideRenderInfo) => {
    setFirstPaint((v) => v ?? info.sinceOpenMs);
    setLastRender(info);
    setRenderCount((n) => n + 1);
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-[var(--gutter)] pb-16 pt-4">
      <header className="flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 rounded-lg font-bold tracking-[-0.4px]" aria-label="PoC 허브로">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
          <img src="/brand/symbol.svg" alt="" width={26} height={26} />
          <span className="text-[19px]">PR·SIM</span>
        </Link>
        <span className="rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold text-secondary">PoC · Slide View</span>
      </header>

      <section>
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">발표자료 넘겨보기</h1>
        <p className="mt-1 text-secondary">PDF를 올리면 손가락이나 마우스로 좌우로 넘길 수 있어요.</p>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <section className="flex min-w-0 flex-col gap-3">
          {picked ? (
            <>
              <SlideViewer
                ref={viewer}
                key={`${picked.nonce}-${mainThread}`}
                src={picked.src}
                keyboard="global"
                stageAspect="current"
                disableWorkerRendering={mainThread}
                onPageChange={(p, total) => setPage({ p, total })}
                onLoad={setLoad}
                onRender={onRender}
                onError={setViewerError}
              />
              <p className="text-center text-[13px] text-secondary">스와이프 · 드래그 · ←/→ 키 · 더블탭 확대 · F 전체 화면</p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              data-dropzone
              className={`flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 rounded-[28px] border-2 border-dashed p-6 text-center transition-colors ${
                dragging ? "border-ink bg-card" : "border-line bg-surface hover:bg-card"
              }`}
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas text-ink">
                <UploadIcon />
              </span>
              <span className="text-[20px] font-semibold tracking-[-0.4px]">발표자료 PDF 올리기</span>
              <span className="text-sm text-secondary">눌러서 선택하거나 여기로 끌어다 놓으세요 · 최대 {fmtBytes(MAX_UPLOAD_BYTES)}</span>
            </button>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-[20px] bg-surface p-5">
            <h2 className="text-[16px] font-semibold">자료 선택</h2>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              data-testid="pdf-input"
              aria-label="PDF 파일 선택"
              onChange={(e) => {
                pickFile(e.currentTarget.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="h-14 rounded-[20px] bg-ink text-[16px] font-semibold text-inverse"
            >
              {picked?.kind === "upload" ? "다른 PDF 올리기" : "PDF 올리기"}
            </button>
            <div className="grid grid-cols-2 gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  data-sample={s.key}
                  onClick={() => pickSample(s.key)}
                  aria-pressed={picked?.kind === "sample" && picked.name === s.title}
                  className={`flex min-h-[64px] flex-col items-start justify-center rounded-[16px] px-4 py-2 text-left transition-colors ${
                    picked?.kind === "sample" && picked.name === s.title ? "bg-ink text-inverse" : "bg-canvas text-ink hover:bg-card"
                  }`}
                >
                  <span className="text-[14px] font-semibold">{s.title}</span>
                  <span className={`text-[12px] ${picked?.name === s.title ? "text-inverse/70" : "text-secondary"}`}>{s.desc}</span>
                </button>
              ))}
            </div>
            {uploadError && (
              <p role="alert" className="text-sm font-medium text-error">
                {uploadError}
              </p>
            )}
            {picked && (
              <div className="flex items-center justify-between gap-2 rounded-[16px] bg-canvas px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold" data-file-name>
                    {picked.name}
                  </p>
                  <p className="text-[12px] text-secondary tabular">
                    {viewerError ? <span className="text-error">{viewerError}</span> : load ? `${load.numPages}쪽` : "불러오는 중…"}
                    {picked.bytes ? ` · ${fmtBytes(picked.bytes)}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(null);
                    reset();
                  }}
                  className="h-11 shrink-0 rounded-full bg-surface px-4 text-[14px] font-semibold"
                >
                  닫기
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-[20px] bg-surface p-5" data-metrics>
            <h2 className="text-[16px] font-semibold">측정값</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px] tabular">
              <dt className="text-secondary">현재 쪽</dt>
              <dd className="text-right font-semibold" data-metric="page">{page ? `${page.p} / ${page.total}` : "–"}</dd>
              <dt className="text-secondary">문서 로딩</dt>
              <dd className="text-right" data-metric="load">{ms(load?.loadMs)}</dd>
              <dt className="text-secondary">첫 페이지 표시</dt>
              <dd className="text-right font-semibold" data-metric="ttfp">{ms(firstPaint ?? undefined)}</dd>
              <dt className="text-secondary">최근 렌더</dt>
              <dd className="text-right" data-metric="last-render">
                {lastRender ? `${lastRender.page}쪽 · ${ms(lastRender.ms)} · ×${lastRender.outputScale.toFixed(1)}` : "–"}
              </dd>
              <dt className="text-secondary">렌더 횟수</dt>
              <dd className="text-right" data-metric="renders">{renderCount}</dd>
              <dt className="text-secondary">렌더러</dt>
              <dd className="text-right" data-metric="renderer">
                {lastRender ? (lastRender.workerRendering ? "워커 (OffscreenCanvas)" : "메인 스레드") : "–"}
              </dd>
              <dt className="text-secondary">페이지 크기</dt>
              <dd className="text-right">{load ? `${Math.round(load.pageWidth)}×${Math.round(load.pageHeight)}pt` : "–"}</dd>
            </dl>
            <label className="mt-2 flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[14px]">
              <span>메인 스레드로 렌더 (비교용)</span>
              <input type="checkbox" checked={mainThread} onChange={(e) => {
                  reset();
                  setMainThread(e.currentTarget.checked);
                }} className="h-5 w-5 accent-[#111]" />
            </label>
            {picked && (
              <div className="mt-1 flex gap-2">
                <button type="button" className="h-11 flex-1 rounded-full bg-canvas text-[14px] font-semibold" onClick={() => {
                    viewer.current?.goTo(1);
                    viewer.current?.focus(); // Space/←/→ then drive the slides, not this button
                  }}>
                  처음으로
                </button>
                <button
                  type="button"
                  className="h-11 flex-1 rounded-full bg-canvas text-[14px] font-semibold"
                  onClick={() => {
                    viewer.current?.goTo(viewer.current.total);
                    viewer.current?.focus();
                  }}
                >
                  마지막으로
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-6" aria-hidden="true">
          <div className="rounded-[28px] bg-canvas px-8 py-6 text-center">
            <p className="text-[20px] font-semibold">여기에 PDF를 놓으세요</p>
            <p className="mt-1 text-sm text-secondary">놓으면 바로 열려요</p>
          </div>
        </div>
      )}
    </main>
  );
}
