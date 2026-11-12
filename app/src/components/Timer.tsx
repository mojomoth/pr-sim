function mmss(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Phase timer: label, mm:ss (Timer token 32/40 600, tabular) and a draining progress bar.
 * Turns red under `warnAt` seconds and says so in text (not color only). The digits are aria-hidden;
 * a polite live region announces only the 1분 / 30초 / 종료 milestones.
 */
export function Timer({ label, remaining, total, warnAt = 30, compact }: { label: string; remaining: number; total: number; warnAt?: number; compact?: boolean }) {
  const warn = remaining <= warnAt && remaining > 0;
  const done = remaining <= 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  const milestone = done ? `${label} 종료` : remaining <= 30 ? "30초 남음" : remaining <= 60 ? "1분 남음" : "";
  return (
    <div className={`flex flex-col items-center ${compact ? "gap-1" : "gap-1.5"}`}>
      <p className={`text-[14px] font-medium leading-5 ${warn || done ? "text-error" : "text-secondary"}`}>
        {label}
        {warn && " · 곧 종료"}
        {done && " · 종료"}
      </p>
      <p className={`tabular font-semibold ${compact ? "text-[28px] leading-9" : "text-[32px] leading-10"} tracking-[-1px] ${warn || done ? "text-error" : "text-ink"}`} aria-hidden="true" data-testid="timer">
        {mmss(remaining)}
      </p>
      <span className="sr-only" aria-live="polite">
        {milestone}
      </span>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-label={`${label} 진행`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 - pct)}>
        <div className={`h-full w-full rounded-full transition-transform duration-300 ease-linear ${warn || done ? "bg-error" : "bg-ink"}`} style={{ transform: `translateX(${pct - 100}%)` }} />
      </div>
    </div>
  );
}
