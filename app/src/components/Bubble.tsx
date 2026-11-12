/**
 * Speech bubble. `variant="judge"` = judge question / my live transcript on gray, `variant="me"` =
 * my answer (black, inverse text, right-aligned). `listening` shows "음성 인식 중" and a blinking caret
 * after the text; otherwise `status` (e.g. "인식 완료") is shown next to the label.
 */
export function Bubble({
  label,
  status,
  listening,
  children,
  variant = "judge",
  live,
  className = "",
}: {
  label?: React.ReactNode;
  status?: React.ReactNode;
  listening?: boolean;
  children: React.ReactNode;
  variant?: "judge" | "me";
  live?: boolean;
  className?: string;
}) {
  const me = variant === "me";
  const state = listening ? "음성 인식 중" : status;
  return (
    <div className={`rounded-[20px] px-5 py-4 ${me ? "ml-auto w-[88%] rounded-br-[6px] bg-ink text-inverse" : "bg-surface text-ink"} ${className}`} aria-live={live ? "polite" : undefined}>
      {(label || state) && (
        <p className={`mb-1 text-[13px] leading-5 ${me ? "text-inverse/75" : "text-secondary"}`}>
          {label}
          {label && state ? " · " : ""}
          {state}
        </p>
      )}
      <div className="whitespace-pre-line text-[17px] font-medium leading-[26px] tracking-[-0.3px]">
        {children}
        {listening && <span className={`ui-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] ${me ? "bg-inverse" : "bg-ink"}`} aria-hidden="true" />}
      </div>
    </div>
  );
}
