"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** 225 → "03:45" (rounds up, so "00:00" only at the very end). */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Wall-clock countdown: remaining time is computed from Date.now(), so it does not drift and stays
 * correct after the tab was in the background (timers throttled) — it re-syncs on visibilitychange.
 * `running=false` pauses (keeps the remaining time); `running=true` resumes from there.
 * Changing `totalSeconds` or `initial` restarts (from `initial` if given, e.g. a resumed session).
 * Calls `onEnd` once when it reaches 0. Returns remaining seconds (fractional).
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
    const tick = () => {
      const r = Math.max(0, (endAt - Date.now()) / 1000);
      left.current = r;
      setSt({ total: totalSeconds, initial, remaining: r });
      if (r <= 0 && !ended.current) {
        ended.current = true;
        window.clearInterval(id);
        onEndRef.current?.();
      }
    };
    const id = window.setInterval(tick, 200);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, totalSeconds, initial]);

  return st.total === totalSeconds && st.initial === initial ? st.remaining : Math.min(totalSeconds, initial ?? totalSeconds);
}

/** Seconds override from ?sec=N, so testers can reach the time-up transition quickly. */
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
