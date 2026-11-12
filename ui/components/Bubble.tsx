/**
 * Speech bubble. `tone="surface"` = judge question / transcript (gray), `tone="ink"` = my answer
 * (black with inverse text, right-aligned).
 */
export function Bubble({
  label,
  status,
  children,
  tone = "surface",
  live,
  className = "",
}: {
  label?: React.ReactNode;
  status?: React.ReactNode;
  children: React.ReactNode;
  tone?: "surface" | "ink";
  live?: boolean;
  className?: string;
}) {
  const ink = tone === "ink";
  return (
    <div
      className={`rounded-[20px] px-5 py-4 ${ink ? "ml-auto w-[88%] rounded-br-[6px] bg-ink text-inverse" : "bg-surface text-ink"} ${className}`}
      aria-live={live ? "polite" : undefined}
    >
      {(label || status) && (
        <p className={`mb-1 text-[13px] leading-5 ${ink ? "text-inverse/75" : "text-secondary"}`}>
          {label}
          {label && status ? " · " : ""}
          {status}
        </p>
      )}
      <div className="whitespace-pre-line text-[17px] font-medium leading-[26px] tracking-[-0.3px]">{children}</div>
    </div>
  );
}

/** Blinking caret appended to in-progress STT text. */
export function Caret({ inverse }: { inverse?: boolean }) {
  return <span className={`ui-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] ${inverse ? "bg-inverse" : "bg-ink"}`} aria-hidden="true" />;
}
