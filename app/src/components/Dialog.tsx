"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

/**
 * Bottom-sheet modal. Portals into #app-screen so it stays inside the phone frame (and out of
 * transformed page containers). Focuses the first button, keeps Tab inside, Esc closes, restores focus.
 */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose?: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
      if (e.key !== "Tab" || !ref.current) return;
      const items = ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, textarea, [tabindex]:not([tabindex='-1'])");
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="ui-fade fixed inset-0 z-50 flex items-end justify-center bg-ink/40" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="ui-sheet w-full rounded-t-[28px] bg-canvas px-6 pt-6"
        style={{ paddingBottom: "max(20px, var(--safe-bottom))" }}
      >
        <h2 id={titleId} className="text-[20px] font-semibold leading-7 tracking-[-0.4px]">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.getElementById("app-screen") ?? document.body,
  );
}

/** Two-button confirm sheet (e.g. 시뮬레이션을 종료할까요?). Cancel is the safe default and comes first. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "계속하기",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {body && <p className="mt-2 text-[15px] leading-[22px] text-secondary">{body}</p>}
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="secondary" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

/** Phase transition notice (DESIGN.md: 단계 전환을 명시) that moves to `href` after `seconds`. */
export function PhaseEndDialog({ open, title, body, nextLabel, href, seconds = 4 }: { open: boolean; title: string; body: string; nextLabel: string; href: string; seconds?: number }) {
  const router = useRouter();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!open) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      const l = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(l);
      if (l === 0) {
        window.clearInterval(id);
        router.push(href);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [open, seconds, href, router]);
  return (
    <Dialog open={open} title={title}>
      <p className="mt-2 text-[15px] leading-[22px] text-secondary">{body}</p>
      <p className="mt-4 text-[14px] font-medium tabular" aria-live="polite">
        {left}초 뒤 자동으로 넘어가요
      </p>
      <div className="mt-5">
        <Button href={href} arrow>
          {nextLabel}
        </Button>
      </div>
    </Dialog>
  );
}
