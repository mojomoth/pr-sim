/**
 * Decorative waveform. `level` (0–1, e.g. live mic RMS) scales the bars; otherwise a CSS
 * animation runs while `active`. Hidden from assistive tech — pair with a text status.
 */
export function Waveform({ bars = 12, active = true, level, className = "" }: { bars?: number; active?: boolean; level?: number; className?: string }) {
  const shape = Array.from({ length: bars }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin((i + 1) * 1.7)));
  return (
    <span className={`inline-flex items-center gap-[3px] ${className}`} aria-hidden="true">
      {shape.map((h, i) => {
        const scale = level !== undefined ? Math.max(0.15, Math.min(1, h * (0.25 + level * 1.6))) : active ? h : 0.2;
        return (
          <span
            key={i}
            className={`block w-[2.5px] rounded-full bg-current ${active && level === undefined ? "ui-wave" : ""}`}
            style={{ height: "100%", transform: `scaleY(${scale})`, animationDelay: `${(i % 6) * 110}ms`, transition: "transform 120ms linear" }}
          />
        );
      })}
    </span>
  );
}
