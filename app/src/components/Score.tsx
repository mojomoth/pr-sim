/** 05 종합 결과: big total score card (Score token 80/88 700) with a verdict line. */
export function TotalScore({ score, caption = "이번 발표의 종합 점수", verdict }: { score: number; caption?: string; verdict?: React.ReactNode }) {
  return (
    <section className="relative rounded-[28px] bg-surface p-6" aria-label={`${caption} ${score}점 (100점 만점)`}>
      <p className="text-[14px] font-medium text-secondary">{caption}</p>
      <p className="mt-1 flex items-baseline gap-2" aria-hidden="true">
        <span className="text-[80px] font-bold leading-[88px] tracking-[-4px] tabular" data-testid="total-score">
          {score}
        </span>
        <span className="text-[22px] font-medium text-secondary tabular">/ 100</span>
      </p>
      {verdict && <p className="mt-1 text-[16px] leading-6 text-secondary">{verdict}</p>}
      <span className="ui-dot absolute right-6 top-6 h-3 w-3 rounded-full bg-ink" aria-hidden="true" />
    </section>
  );
}

/** Row of small score tiles (영역별 점수: 내용 · 전달 · 답변 …). */
export function ScoreTiles({ items, label = "영역별 점수" }: { items: { label: string; value: number }[]; label?: string }) {
  return (
    <ul className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }} aria-label={label}>
      {items.map((it) => (
        <li key={it.label} className="flex flex-col items-center gap-0.5 rounded-[20px] bg-surface px-2 py-4">
          <span className="text-[14px] font-medium text-secondary">{it.label}</span>
          <span className="text-[32px] font-bold leading-10 tracking-[-1px] tabular">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}
