"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Layout";
import { firstLine, setUiState, todayDot, useUiState, type LivePhase } from "../lib/store";

/**
 * Leave-session confirm (종료 button and the header back chevron).
 * Saves the run as 진행 중 with the phase + remaining seconds so 목록 → 이어하기 resumes there, then navigates to `to`.
 */
export function ExitDialog({
  open,
  onClose,
  phase,
  remainingSec,
  to = "/ui/history",
  title = "시뮬레이션을 종료할까요?",
  confirmLabel = "종료하기",
}: {
  open: boolean;
  onClose: () => void;
  phase: LivePhase;
  remainingSec: number;
  to?: string;
  title?: string;
  confirmLabel?: string;
}) {
  const router = useRouter();
  const s = useUiState();
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="mt-2 text-[15px] leading-[22px] text-secondary">지금까지의 진행은 기록에 ‘진행 중’으로 남아요. 목록에서 이어할 수 있어요.</p>
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="secondary" onClick={onClose}>
          계속하기
        </Button>
        <Button
          onClick={() => {
            setUiState({
              lastRun: {
                date: todayDot(),
                title: firstLine(s.situation),
                presentationMinutes: s.presentationMinutes,
                qaMinutes: s.qaMinutes,
                status: "in_progress",
                phase,
                remainingSec: Math.max(1, Math.ceil(remainingSec)),
              },
              resume: undefined,
            });
            router.push(to);
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/** Explicit phase transition notice (DESIGN.md: 단계 전환을 명시) with a short auto-advance. */
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
      <p className="mt-4 text-[14px] font-medium tabular" aria-live="polite" data-testid="phase-countdown">
        {left}초 후 자동으로 이동해요
      </p>
      <div className="mt-5">
        <Button href={href} arrow>
          {nextLabel}
        </Button>
      </div>
    </Dialog>
  );
}
