import { Mic, MicOff, Video, VideoOff } from "./Icons";

/**
 * Page container inside #app-scroll: 24px gutter (20px ≤360), single column, max 560px.
 * `bottomPad` reserves room for a fixed <BottomBar/> (bar height in px; the bottom safe area is added).
 */
export function Screen({ children, bottomPad = 0, className = "" }: { children: React.ReactNode; bottomPad?: number; className?: string }) {
  return (
    <div
      className={`ui-enter mx-auto flex w-full max-w-[560px] flex-1 flex-col px-[var(--gutter)] ${className}`}
      style={bottomPad ? { paddingBottom: `calc(${bottomPad}px + var(--safe-bottom-pad))` } : undefined}
    >
      {children}
    </div>
  );
}

/** Large gray card (radius 28, 24px padding) with an optional card heading. */
export function Card({ title, children, className = "", as: Tag = "section" }: { title?: React.ReactNode; children: React.ReactNode; className?: string; as?: "section" | "div" | "li" }) {
  return (
    <Tag className={`rounded-[28px] bg-surface p-6 ${className}`}>
      {title && <h3 className="mb-3 text-[20px] font-semibold leading-7 tracking-[-0.4px]">{title}</h3>}
      {children}
    </Tag>
  );
}

/** Round mic/camera toggle with a visible text state (not icon-only). */
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
