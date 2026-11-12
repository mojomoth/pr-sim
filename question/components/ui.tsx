"use client";
// Small design-system primitives for the question PoC (DESIGN.md tokens: black/white, big radii, no shadows).
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Temperament } from "@/lib/types";
import { TEMPERAMENT_LABEL } from "@/lib/types";

export function Button({ variant = "primary", size = "md", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "md" | "lg" | "sm" }) {
  const v = variant === "primary" ? "bg-ink text-inverse disabled:bg-line disabled:text-secondary" : variant === "secondary" ? "bg-surface text-ink disabled:text-secondary" : "bg-transparent text-ink underline-offset-4 hover:underline";
  const s = size === "lg" ? "h-14 px-6 rounded-[20px] text-base" : size === "sm" ? "min-h-11 px-4 rounded-full text-sm" : "min-h-12 px-5 rounded-[16px] text-[15px]";
  return <button type="button" {...p} className={`inline-flex items-center justify-center gap-2 font-semibold transition-opacity active:opacity-80 disabled:cursor-not-allowed ${v} ${s} ${className}`} />;
}

export function Chip({ selected, children, className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button type="button" aria-pressed={selected} {...p} className={`min-h-11 rounded-full px-4 text-sm font-medium transition-colors ${selected ? "bg-ink text-inverse" : "bg-surface text-ink"} ${className}`}>
      {children}
    </button>
  );
}

export function Tag({ children, tone = "surface", className = "" }: { children: ReactNode; tone?: "surface" | "ink" | "line" | "error"; className?: string }) {
  const t = tone === "ink" ? "bg-ink text-inverse" : tone === "line" ? "border border-line text-secondary" : tone === "error" ? "border border-error text-error" : "bg-surface text-ink";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${t} ${className}`}>{children}</span>;
}

export function TemperamentTag({ t }: { t: Temperament }) {
  return <Tag tone={t === "aggressive" ? "ink" : t === "strict" ? "line" : "surface"}>{TEMPERAMENT_LABEL[t]}</Tag>;
}

export function Card({ children, className = "", as: As = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div"; "data-testid"?: string }) {
  return (
    <As className={`rounded-[28px] bg-surface p-5 sm:p-6 ${className}`} {...rest}>
      {children}
    </As>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.4px]">{children}</h2>
      {aside}
    </div>
  );
}

export function Face({ name, imageUrl, className = "", rounded = "rounded-full" }: { name: string; imageUrl?: string; className?: string; rounded?: string }) {
  return (
    <div className={`relative shrink-0 overflow-hidden bg-card ${rounded} ${className}`}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin judge thumbnails with query params; next/image adds nothing here
        <img src={imageUrl} alt={`${name} 심사위원 얼굴`} className="h-full w-full object-cover" />
      ) : (
        <div role="img" aria-label={`${name} (얼굴 없음)`} className="flex h-full w-full items-center justify-center text-lg font-bold text-secondary">
          {name.slice(0, 1)}
        </div>
      )}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[20px] bg-canvas px-4 py-3">
      <div className="text-xs text-secondary">{label}</div>
      <div className="tabular truncate text-lg font-semibold">{value}</div>
      {sub ? <div className="tabular truncate text-xs text-secondary">{sub}</div> : null}
    </div>
  );
}

export const ms = (n?: number) => (n == null ? "–" : n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}초`);
