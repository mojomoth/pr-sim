"use client";
import { useRef } from "react";
import { TEMPERAMENT_LABEL, type Temperament } from "@/lib/types";

/** Pill chip. Selected = black surface (DESIGN.md). */
export function Chip({ selected, onClick, children, size = "md", onSurface, ...rest }: { selected?: boolean; onClick?: () => void; children: React.ReactNode; size?: "sm" | "md"; onSurface?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-full font-medium transition-colors duration-200 ${
        size === "sm" ? "h-9 px-3 text-[14px]" : "h-11 px-5 text-[15px]"
      } ${selected ? "bg-ink text-inverse" : onSurface ? "bg-card text-ink hover:bg-line" : "bg-surface text-ink hover:bg-card"}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Filter/segmented group with roving arrow-key support. */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  size,
  className = "",
  onSurface,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
  onSurface?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const n = (i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    onChange(options[n].value);
    ref.current?.querySelectorAll<HTMLButtonElement>("button")[n]?.focus();
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKey} className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((o) => (
        <Chip
          key={o.value}
          size={size}
          onSurface={onSurface}
          selected={o.value === value}
          onClick={() => onChange(o.value)}
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

export const TEMPERAMENT_OPTIONS: { value: Temperament; label: string }[] = (["friendly", "strict", "aggressive"] as const).map((t) => ({
  value: t,
  label: TEMPERAMENT_LABEL[t],
}));

/** Single-select persona chips: 친절함 / 빡셈 / 공격적. */
export function PersonaChips({ value, onChange, name }: { value: Temperament; onChange: (t: Temperament) => void; name: string }) {
  return <ChipGroup size="sm" label={`${name} 성향`} options={TEMPERAMENT_OPTIONS} value={value} onChange={onChange} className="gap-1.5" onSurface />;
}

/** Small status badge (완료 / 진행 중 …). */
export function Badge({ children, tone = "ink" }: { children: React.ReactNode; tone?: "ink" | "muted" | "surface" }) {
  const cls = tone === "ink" ? "bg-ink text-inverse" : tone === "muted" ? "bg-secondary/80 text-inverse" : "bg-canvas text-ink";
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold leading-[18px] ${cls}`}>{children}</span>;
}
