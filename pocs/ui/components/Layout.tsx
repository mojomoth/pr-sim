"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, Video, VideoOff } from "./Icons";

/**
 * Page container: 24px gutter (20px ≤360), mobile-first.
 * width="narrow" (≤560) for single-column screens, "wide" (≤1120) for desktop 2-column screens.
 * `bottomPad` reserves space for a fixed BottomBar.
 */
export function Screen({ children, width = "narrow", bottomPad = 0, className = "" }: { children: React.ReactNode; width?: "narrow" | "wide"; bottomPad?: number; className?: string }) {
  return (
    <div
      className={`ui-enter mx-auto flex w-full flex-1 flex-col px-[var(--gutter)] ${width === "wide" ? "max-w-[1120px]" : "max-w-[560px]"} ${className}`}
      style={bottomPad ? { paddingBottom: `calc(${bottomPad}px + max(16px, env(safe-area-inset-bottom)))` } : undefined}
    >
      {children}
    </div>
  );
}

/** Round mic/camera toggle with visible text state (not icon-only). */
export function MediaToggle({ kind, on, onToggle }: { kind: "mic" | "camera"; on: boolean; onToggle: () => void }) {
  const label = kind === "mic" ? "마이크" : "카메라";
  const Icon = kind === "mic" ? (on ? Mic : MicOff) : on ? Video : VideoOff;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-colors ${on ? "bg-surface text-ink" : "bg-ink text-inverse"}`}
    >
      <Icon size={20} />
      {label} {on ? "켜짐" : "꺼짐"}
    </button>
  );
}

/** Modal dialog base with focus trap-lite (focus first button, Esc to close). */
export function Dialog({ open, onClose, title, children, labelledBy = "ui-dialog-title" }: { open: boolean; onClose?: () => void; title: string; children: React.ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  // Portal to <body>: animated (transformed) page containers would otherwise trap the fixed overlay.
  return createPortal(
    <div className="ui-fade fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        className="ui-sheet w-full max-w-[440px] rounded-t-[28px] bg-canvas px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-6 sm:rounded-[28px] sm:pb-6"
      >
        <h2 id={labelledBy} className="text-[20px] font-semibold leading-7 tracking-[-0.4px]">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
