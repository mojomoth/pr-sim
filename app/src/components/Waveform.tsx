/**
 * Decorative waveform (drafts 03/04): thin 1.5px lines of varying height under a bell envelope,
 * fading out toward both ends. `level` (0–1, e.g. live mic RMS) scales the lines; otherwise a CSS
 * animation runs while `active`. Hidden from assistive tech — pair with a text status.
 */
export function Waveform({ bars = 12, active = true, level, className = "" }: { bars?: number; active?: boolean; level?: number; className?: string }) {
  const lines = Array.from({ length: bars }, (_, i) => {
    const bell = Math.sin((Math.PI * (i + 0.5)) / bars); // 0 at the ends → 1 in the middle
    const jitter = 0.4 + 0.6 * Math.abs(Math.sin((i + 1) * 1.7) * Math.cos((i + 1) * 0.6));
    return { h: Math.max(0.18, (0.3 + 0.7 * bell) * jitter), o: Math.min(1, 0.25 + 1.1 * bell) };
  });
  const scale = level !== undefined ? Math.max(0.2, Math.min(1, 0.3 + level * 1.6)) : active ? 1 : 0.35;
  return (
    <span className={`inline-flex items-center gap-[3px] ${className}`} aria-hidden="true">
      {lines.map(({ h, o }, i) => (
        <span
          key={i}
          className={`block w-[1.5px] shrink-0 rounded-full bg-current ${active && level === undefined ? "ui-wave" : ""}`}
          style={{ height: `${h * 100}%`, opacity: o, transform: `scaleY(${scale})`, animationDelay: `${(i % 6) * 110}ms`, transition: "transform 120ms linear" }}
        />
      ))}
    </span>
  );
}
