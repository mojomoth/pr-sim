"use client";
import { useId } from "react";
import { Minus, Plus } from "./Icons";

/**
 * Minute slider: native range input (keyboard/screen-reader friendly) styled per DESIGN.md
 * — thin gray track, black active segment, black round thumb — with −/+ buttons so the
 * value can be changed without dragging. No min/max captions (draft 02); the range carries them for AT.
 */
/** 28px −/+ circle as in draft 02; an invisible ::before keeps the 44px tap target. */
const STEP =
  "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-ink before:absolute before:-inset-2 before:content-[''] disabled:opacity-40";

export function MinuteSlider({ label, value, min, max, onChange, unit = "분" }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; unit?: string }) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[16px] font-semibold">
          {label}
        </label>
        <output htmlFor={id} className="text-[22px] font-bold tabular tracking-[-0.6px]" aria-live="polite">
          {value}
          {unit}
        </output>
      </div>
      <div className="flex h-10 items-center gap-4 rounded-[12px] bg-surface px-2.5">
        <button type="button" aria-label={`${label} 1${unit} 줄이기`} onClick={() => set(value - 1)} disabled={value <= min} className={STEP}>
          <Minus size={16} />
        </button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => set(Number(e.target.value))}
          aria-valuetext={`${value}${unit}`}
          className="ui-range h-11 min-w-0 flex-1"
          style={{ ["--pct" as string]: `${pct}%` }}
        />
        <button type="button" aria-label={`${label} 1${unit} 늘리기`} onClick={() => set(value + 1)} disabled={value >= max} className={STEP}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}
