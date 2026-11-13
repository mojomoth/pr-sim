function mmss(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Phase timer: label, mm:ss and a progress bar whose fill is the elapsed time (drafts 03/04: the dark
 * part grows from the left; aria-valuenow is elapsed % too). `compact` is the large live-screen
 * timer that anchors 03/04 (heavy 60px digits). `tone="muted"` = draft 04 bar: thicker, mid-gray, inset.
 * Turns red under `warnAt` seconds and says so in text (not color only). The digits are aria-hidden;
 * a polite live region announces only the 1분 / 30초 / 종료 milestones.
 */
export function Timer({ label, remaining, total, warnAt = 30, compact, tone = "ink" }: { label: string; remaining: number; total: number; warnAt?: number; compact?: boolean; tone?: "ink" | "muted" }) {
  const warn = remaining <= warnAt && remaining > 0;
  const done = remaining <= 0;
  const elapsedPct = total > 0 ? Math.max(0, Math.min(100, 100 - (remaining / total) * 100)) : 100;
  const milestone = done ? `${label} 종료` : remaining <= 30 ? "30초 남음" : remaining <= 60 ? "1분 남음" : "";
  const muted = tone === "muted";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <p className={`text-[14px] font-medium leading-5 ${warn || done ? "text-error" : "text-secondary"}`}>
        {label}
        {warn && " · 곧 종료"}
        {done && " · 종료"}
      </p>
      <p
        className={`tabular ${compact ? "text-[60px] font-black leading-[64px] tracking-[-2px]" : "text-[32px] font-semibold leading-10 tracking-[-1px]"} ${warn || done ? "text-error" : "text-ink"}`}
        aria-hidden="true"
        data-testid="timer"
      >
        {mmss(remaining)}
      </p>
      <span className="sr-only" aria-live="polite">
        {milestone}
      </span>
      <div
        className={`overflow-hidden rounded-full bg-line ${muted ? "mt-2 h-2.5 w-[calc(100%-24px)]" : "mt-2 h-1.5 w-full"}`}
        role="progressbar"
        aria-label={`${label} 진행`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(elapsedPct)}
      >
        <div className={`h-full w-full rounded-full transition-transform duration-300 ease-linear ${warn || done ? "bg-error" : muted ? "bg-secondary" : "bg-ink"}`} style={{ transform: `translateX(${elapsedPct - 100}%)` }} />
      </div>
    </div>
  );
}
