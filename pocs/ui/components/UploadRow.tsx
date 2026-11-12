"use client";
import { useId, useRef, useState } from "react";
import type { FileMeta } from "../lib/store";
import { countPages, formatBytes } from "../lib/pdf";
import { Alert, Close, FileDoc, Refresh, Upload } from "./Icons";

type Status = "idle" | "uploading" | "error";

/**
 * PDF upload row with four states: empty → uploading (progress) → uploaded (name · pages · replace/remove)
 * or error (message · retry). Page count is read client-side with pdfjs-dist.
 */
export function UploadRow({
  label,
  required,
  value,
  onUploaded,
  onRemove,
  onSample,
  sampleLabel = "샘플 자료 사용",
}: {
  label: string;
  required?: boolean;
  value?: FileMeta;
  onUploaded: (meta: FileMeta, blob: Blob) => void;
  onRemove: () => void;
  onSample?: () => Promise<void> | void;
  sampleLabel?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [pendingName, setPendingName] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const pick = () => input.current?.click();
  const dismiss = () => {
    setStatus("idle");
    setError("");
  };
  const remove = () => {
    dismiss();
    onRemove();
  };

  async function handle(file: File) {
    setPendingName(file.name);
    setError("");
    setStatus("uploading");
    setProgress(8);
    const started = performance.now();
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    // Visible progress even for instant local reads (min ~700ms).
    let p = 8;
    const timer = window.setInterval(() => {
      p = Math.min(90, p + 9);
      setProgress(p);
    }, 70);
    try {
      if (!isPdf) throw new Error("PDF 파일만 올릴 수 있어요.");
      let pages: number;
      try {
        pages = await countPages(file);
      } catch {
        throw new Error("PDF를 읽지 못했어요. 파일이 손상되었는지 확인해 주세요.");
      }
      const wait = 700 - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setProgress(100);
      onUploaded({ name: file.name, pages, size: file.size }, file);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드에 실패했어요.");
      setStatus("error");
    } finally {
      window.clearInterval(timer);
      if (input.current) input.current.value = "";
    }
  }

  async function useSample() {
    if (!onSample) return;
    setPendingName("샘플 자료");
    setStatus("uploading");
    setProgress(40);
    try {
      await onSample();
      setStatus("idle");
    } catch {
      setError("샘플 자료를 불러오지 못했어요.");
      setStatus("error");
    }
  }

  const fileInput = (
    <input
      ref={input}
      id={id}
      type="file"
      accept="application/pdf,.pdf"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void handle(f);
      }}
    />
  );

  const header = (
    <div className="flex items-center justify-between">
      <span className="text-[16px] font-semibold">
        {label}
        <span className="ml-1.5 text-[13px] font-medium text-secondary">{required ? "필수" : "선택"}</span>
      </span>
      {onSample && !value && status !== "uploading" && (
        <button type="button" onClick={useSample} className="min-h-11 px-1 text-[14px] font-medium text-secondary underline underline-offset-4 hover:text-ink">
          {sampleLabel}
        </button>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (status === "uploading") {
    body = (
      <div className="flex min-h-[64px] flex-col justify-center gap-2 rounded-[16px] bg-surface px-4 py-3" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3 text-[14px]">
          <span className="truncate font-medium">{pendingName}</span>
          <span className="shrink-0 text-secondary tabular">업로드 중 {progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <div className="h-full rounded-full bg-ink transition-[width] duration-150" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  } else if (status === "error" && !value) {
    body = (
      <div className="flex min-h-[64px] items-center gap-3 rounded-[16px] border border-error/40 bg-canvas px-4 py-3" role="alert">
        <Alert size={22} className="shrink-0 text-error" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-error">업로드 실패</p>
          <p className="text-[13px] leading-[18px] text-secondary">{error}</p>
        </div>
        <button type="button" onClick={pick} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-4 text-[14px] font-semibold">
          <Refresh size={16} /> 다시 시도
        </button>
        <button type="button" onClick={dismiss} className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-surface" aria-label="오류 닫기">
          <Close size={18} />
        </button>
      </div>
    );
  } else if (value) {
    body = (
      <div className="flex min-h-[64px] items-center gap-3 rounded-[16px] bg-surface py-2.5 pl-4 pr-2">
        <FileDoc size={26} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold leading-6">{value.name}</p>
          <p className="text-[13px] leading-[18px] text-secondary tabular">
            {value.pages}페이지 · {formatBytes(value.size)}
            {value.sample ? " · 샘플" : ""}
          </p>
        </div>
        <button type="button" onClick={pick} className="inline-flex h-11 shrink-0 items-center rounded-full px-3 text-[14px] font-semibold hover:bg-card" aria-label={`${label} 교체`}>
          교체
        </button>
        <button type="button" onClick={remove} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-card" aria-label={`${label} 삭제`}>
          <Close size={20} />
        </button>
      </div>
    );
    // A failed replace must not hide the file that is still in use.
    if (status === "error")
      body = (
        <div className="flex flex-col gap-2">
          {body}
          <div className="flex items-center gap-2.5 rounded-[16px] border border-error/40 bg-canvas py-2 pl-4 pr-2" role="alert">
            <Alert size={18} className="shrink-0 text-error" />
            <p className="min-w-0 flex-1 text-[13px] leading-[18px]">
              <span className="font-semibold text-error">교체 실패</span>
              <span className="text-secondary"> · {error} 기존 파일을 계속 사용해요.</span>
            </p>
            <button type="button" onClick={dismiss} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-surface" aria-label="오류 닫기">
              <Close size={18} />
            </button>
          </div>
        </div>
      );
  } else {
    body = (
      <button
        type="button"
        onClick={pick}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handle(f);
        }}
        className={`flex min-h-[64px] w-full items-center justify-center gap-2 rounded-[16px] border px-4 text-[15px] font-medium transition-colors ${
          dragOver ? "border-ink bg-surface" : "border-line text-secondary hover:border-ink/40 hover:text-ink"
        }`}
        aria-label={`${label} PDF 업로드 (${required ? "필수" : "선택"})`}
      >
        <Upload size={20} />
        PDF 업로드 ({required ? "필수" : "선택"})
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {header}
      {body}
      {fileInput}
    </div>
  );
}
