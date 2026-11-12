"use client";
// Small presentational atoms for the report UI (PR-SIM design language: monochrome, big radii, no shadows).
import { DOC_LABEL, type DocRef } from "../lib/types";

export function Card({ children, className = "", tone = "card" }: { children: React.ReactNode; className?: string; tone?: "card" | "surface" | "ink" }) {
  const bg = tone === "card" ? "bg-card" : tone === "surface" ? "bg-surface" : "bg-ink text-inverse";
  return <section className={`rounded-[28px] ${bg} p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[14px] font-medium leading-5 text-secondary ${className}`}>{children}</p>;
}

export function H2({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-[20px] font-semibold leading-7 tracking-[-0.4px] ${className}`}>{children}</h2>;
}

export function Pill({ children, tone = "surface", className = "", title }: { children: React.ReactNode; tone?: "surface" | "ink" | "line" | "canvas"; className?: string; title?: string }) {
  const cls =
    tone === "ink" ? "bg-ink text-inverse" : tone === "line" ? "border border-line bg-canvas text-ink" : tone === "canvas" ? "bg-canvas text-ink" : "bg-surface text-ink";
  return (
    <span title={title} className={`inline-flex min-h-8 items-center rounded-full px-3 text-[14px] font-semibold leading-5 tabular ${cls} ${className}`}>
      {children}
    </span>
  );
}

export function ScoreBadge({ score, className = "" }: { score: number | null | undefined; className?: string }) {
  return (
    <span className={`inline-flex h-10 items-center rounded-full bg-surface px-4 text-[17px] font-bold tabular ${className}`} aria-label={`${score ?? "-"}점`}>
      {score ?? "-"}점
    </span>
  );
}

/** Monochrome horizontal meter (no rainbow colors). */
export function Meter({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_36px] items-center gap-3">
      <span className="text-[14px] font-medium leading-5 text-secondary">{label}</span>
      <span className="relative h-2 overflow-hidden rounded-full bg-line" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </span>
      <span className="text-right text-[15px] font-semibold tabular">{value}</span>
      {note && <span className="col-span-3 -mt-1 text-[12px] leading-[18px] text-secondary">{note}</span>}
    </div>
  );
}

export function CheckIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path d="M7 12.5l3.2 3.2L17 9" stroke="var(--color-canvas)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Arrow({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function Chevron({ dir = "left", size = 26 }: { dir?: "left" | "right"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="var(--color-line)" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** "제안자료 p.34" chips that open the source PDF page (wiki PoC serves the original PDF). */
export function RefChips({ refs, docIds, max = 4 }: { refs: DocRef[]; docIds: { presentation?: string; proposal?: string }; max?: number }) {
  const items = refs.flatMap((r) => r.pages.slice(0, max).map((p) => ({ doc: r.doc, page: p, grounded: r.grounded !== false, quote: r.quote })));
  const seen = new Set<string>();
  const uniq = items.filter((i) => {
    const k = `${i.doc}:${i.page}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!uniq.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {uniq.map((i) => {
        const id = docIds[i.doc];
        const text = `${DOC_LABEL[i.doc]} p.${i.page}`;
        const title = i.grounded ? `원문 ${i.page}쪽에서 확인됨${i.quote ? ` — ${i.quote}` : ""}` : "원문에서 값 미확인 (LLM 인용)";
        const cls = `inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold tabular ${i.grounded ? "bg-canvas text-ink border border-line" : "border border-dashed border-secondary text-secondary"}`;
        return id ? (
          <a key={`${i.doc}:${i.page}`} href={`/api/wiki/docs/${id}/pdf#page=${i.page}`} target="_blank" rel="noreferrer" className={`${cls} hover:border-ink`} title={title}>
            {text}
          </a>
        ) : (
          <span key={`${i.doc}:${i.page}`} className={cls} title={title}>
            {text}
          </span>
        );
      })}
    </span>
  );
}

export function fmtSec(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export const SEVERITY_KO = { high: "높음", medium: "중간", low: "낮음" } as const;
