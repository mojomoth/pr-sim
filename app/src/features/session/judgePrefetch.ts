"use client";
// The first three judges of a new draft (one per persona), requested from the landing page so their faces
// are ready (or nearly) by the time /setup opens. Events are buffered in memory and replayed to /setup,
// which stores the photos itself: nothing is written to IndexedDB unless a draft takes the panel, so an
// unused prefetch leaves no blobs behind. A full reload loses it; /setup then calls the API as before.
import type { JudgeEvent } from "@/server/judge/types";
import { streamJudges } from "./api";
import type { Temperament } from "./types";

/** Same order as /setup's persona chips. */
export const FIRST_PANEL: Temperament[] = ["friendly", "strict", "aggressive"];

interface Prefetch {
  events: JudgeEvent[];
  listeners: Set<(e: JudgeEvent) => void>;
  waiters: Set<() => void>;
  result?: { ok: true } | { ok: false; error: unknown };
  taken: boolean;
}

let current: Prefetch | null = null;

/** Start generating the first panel (no-op while one is waiting to be taken or still running for /setup). */
export function prefetchPanel() {
  if (current) return;
  const p: Prefetch = { events: [], listeners: new Set(), waiters: new Set(), taken: false };
  current = p;
  const onEvent = (e: JudgeEvent) => {
    p.events.push(e);
    p.listeners.forEach((l) => l(e));
  };
  streamJudges({ temperaments: FIRST_PANEL }, { onEvent })
    .then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    .then((r) => {
      p.result = r;
      // Taken → its consumer has it. Failed before anyone took it → /setup makes its own request.
      if (current === p && (p.taken || !r.ok)) current = null;
      p.waiters.forEach((w) => w());
    });
}

/**
 * Hand the prefetched panel to a new draft: past events are replayed into `onEvent`, later ones follow,
 * and the promise settles like streamJudges() would. null = nothing usable (call the API instead).
 */
export function takePanel(onEvent: (e: JudgeEvent) => void, signal: AbortSignal): Promise<void> | null {
  const p = current;
  if (!p || p.taken || (p.result && !p.result.ok)) return null;
  p.taken = true;
  if (p.result) current = null;
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      p.listeners.delete(onEvent);
      signal.removeEventListener("abort", abort);
      if (p.result?.ok) resolve();
      else reject(p.result?.error);
    };
    const abort = () => {
      p.listeners.delete(onEvent);
      p.waiters.delete(finish);
      reject(new DOMException("Aborted", "AbortError"));
    };
    p.events.forEach(onEvent);
    if (p.result) return finish();
    p.listeners.add(onEvent);
    p.waiters.add(finish);
    signal.addEventListener("abort", abort, { once: true });
  });
}
