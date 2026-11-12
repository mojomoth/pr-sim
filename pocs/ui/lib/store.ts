// Client-side session store for the UI PoC.
// - Serializable setup/run state lives in sessionStorage (survives reload within the tab).
// - Uploaded PDF File objects live in a module-level Map (survive client-side navigation only).
// The real app can swap this for SQLite-backed persistence without touching the screens.
import { useSyncExternalStore } from "react";
import type { JudgePersona } from "@/lib/types";
import { DEFAULT_JUDGES, DEFAULT_SITUATION } from "./mock";

export interface UiJudge extends JudgePersona {
  role?: string; // e.g. "40대 · 투자심사위원"
}

export interface FileMeta {
  name: string;
  pages: number;
  size: number; // bytes
  sample?: boolean; // filled by "샘플 자료 사용"
}

export type DocSlot = "presentation" | "proposal";

export interface SetupState {
  situation: string;
  presentationMinutes: number;
  qaMinutes: number;
  judges: UiJudge[];
  files: Partial<Record<DocSlot, FileMeta>>;
}

export type LivePhase = "presentation" | "review";

/** A paused live session: which phase and how many seconds were left. */
export interface ResumePoint {
  phase: LivePhase;
  remainingSec: number;
}

export interface RunRecord {
  date: string;
  title: string;
  presentationMinutes: number;
  qaMinutes: number;
  status: "done" | "in_progress";
  score?: number;
  /** in_progress only: where 이어하기 should pick up. */
  phase?: LivePhase;
  remainingSec?: number;
}

export interface RunState {
  /** Last run outcome, prepended to the history list. */
  lastRun?: RunRecord;
  /** Set by 목록 → 이어하기; consumed by the matching live screen's countdown. */
  resume?: ResumePoint;
  /** Set by 목록 → 결과 보기; the results screen shows this record instead of the current run. */
  viewRecord?: RunRecord;
}

export interface UiState extends SetupState, RunState {}

export const DEFAULT_STATE: UiState = {
  situation: DEFAULT_SITUATION,
  presentationMinutes: 5,
  qaMinutes: 3,
  judges: DEFAULT_JUDGES,
  files: {},
};

const KEY = "prsim.ui.state.v1";
const listeners = new Set<() => void>();
let cache: UiState | null = null;

function read(): UiState {
  if (cache) return cache;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    cache = raw ? { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<UiState>) } : DEFAULT_STATE;
  } catch {
    cache = DEFAULT_STATE;
  }
  return cache;
}

export function getUiState(): UiState {
  return typeof window === "undefined" ? DEFAULT_STATE : read();
}

export function setUiState(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
  const prev = read();
  const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
  cache = next;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — keep in memory */
  }
  listeners.forEach((l) => l());
}

export function resetSetup() {
  fileBlobs.clear();
  setUiState({ situation: DEFAULT_STATE.situation, presentationMinutes: 5, qaMinutes: 3, judges: DEFAULT_JUDGES, files: {} });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: reactive UI state. Server render + hydration use DEFAULT_STATE. */
export function useUiState(): UiState {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_STATE);
}

/** True after hydration (useful to avoid flashing defaults for stored values). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
function noopSubscribe() {
  return () => {};
}

// ---- in-memory PDF blobs (per tab, cleared on reload) ----
const fileBlobs = new Map<DocSlot, Blob>();
export function setFileBlob(slot: DocSlot, blob: Blob | null) {
  if (blob) fileBlobs.set(slot, blob);
  else fileBlobs.delete(slot);
}
export function getFileBlob(slot: DocSlot): Blob | undefined {
  return fileBlobs.get(slot);
}

export function todayDot(): string {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function firstLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find(Boolean) ?? "새 발표";
}
