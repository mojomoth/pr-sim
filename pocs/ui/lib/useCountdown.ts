import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Wall-clock based countdown (robust to tab throttling).
 * Returns remaining seconds; calls onEnd once when it reaches 0.
 * `running=false` pauses; changing `totalSeconds` restarts (from `initial` if given, e.g. a resumed session).
 */
export function useCountdown(totalSeconds: number, { running = true, onEnd, initial }: { running?: boolean; onEnd?: () => void; initial?: number } = {}) {
  const [st, setSt] = useState({ total: totalSeconds, initial, remaining: Math.min(totalSeconds, initial ?? totalSeconds) });
  const lastTotal = useRef(totalSeconds);
  const lastInitial = useRef(initial);
  const left = useRef(Math.min(totalSeconds, initial ?? totalSeconds));
  const ended = useRef(false);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    if (lastTotal.current !== totalSeconds || lastInitial.current !== initial) {
      lastTotal.current = totalSeconds;
      lastInitial.current = initial;
      left.current = Math.min(totalSeconds, initial ?? totalSeconds);
      ended.current = false;
    }
    if (!running || ended.current) return;
    const endAt = Date.now() + left.current * 1000;
    const id = window.setInterval(() => {
      const r = Math.max(0, (endAt - Date.now()) / 1000);
      left.current = r;
      setSt({ total: totalSeconds, initial, remaining: r });
      if (r <= 0 && !ended.current) {
        ended.current = true;
        window.clearInterval(id);
        onEndRef.current?.();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [running, totalSeconds, initial]);

  return st.total === totalSeconds && st.initial === initial ? st.remaining : Math.min(totalSeconds, initial ?? totalSeconds);
}

/** Optional seconds override from ?sec=N (HIL: quickly test the auto-transition). */
export function useSecondsOverride(): number | null {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const n = Number(new URLSearchParams(window.location.search).get("sec"));
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    () => null,
  );
}
