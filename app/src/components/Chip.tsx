"use client";
import { useRef } from "react";

/**
 * Pill chip. Selected = black surface (DESIGN.md). `onSurface` = for use on a gray card.
 * `sm` keeps the draft's 36px pill but an invisible ::before stretches the hit area to 44px tall
 * (DESIGN.md tap target) without growing the row.
 */
function Chip({
  selected,
  onClick,
  children,
  size = "md",
  onSurface,
  ...rest
}: { selected?: boolean; onClick?: () => void; children: React.ReactNode; size?: "sm" | "md"; onSurface?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-full font-medium transition-colors duration-200 ${
        size === "sm" ? "relative h-9 px-3 text-[14px] before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']" : "h-11 px-5 text-[15px]"
      } ${selected ? "bg-ink text-inverse" : onSurface ? "bg-card text-ink hover:bg-line" : "bg-surface text-ink hover:bg-card"}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Single-select chip group / segmented control (radiogroup, roving tabindex, ←/→ keys).
 * Used for filters (전체/완료/진행 중) and persona chips (친절함/빡셈/공격적).
 */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  size,
  onSurface,
  className = "",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  onSurface?: boolean;
  className?: string;
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

/** Small status badge (완료 / 진행 중 …). */
export function Badge({ children, tone = "ink" }: { children: React.ReactNode; tone?: "ink" | "muted" | "surface" }) {
  const cls = tone === "ink" ? "bg-ink text-inverse" : tone === "muted" ? "bg-secondary text-inverse" : "bg-canvas text-ink";
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold leading-[18px] ${cls}`}>{children}</span>;
}
