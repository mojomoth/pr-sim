"use client";
// Per-viewer HIL progress (checked steps, verdict, feedback) persisted to localStorage.
// useSyncExternalStore keeps SSR output empty and avoids setState-in-effect; every storage access is try/catch'd
// so the page still works (without persistence) in private windows or when storage is blocked.
import { useSyncExternalStore } from "react";

export type Verdict = "ok" | "fix" | "hold";
export type PocProgress = { checked: string[]; verdict: Verdict | null; feedback: string; updatedAt?: string };
export type HilState = Record<string, PocProgress>;

const KEY = "prsim-hil-v1";
const EMPTY: HilState = {};
let state: HilState = EMPTY;
let loaded = false;
let storageOk = true;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    state = raw ? (JSON.parse(raw) as HilState) : EMPTY;
  } catch {
    storageOk = false;
    state = EMPTY;
  }
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    loaded = false;
    load();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot() {
  load();
  return state;
}
const getServerSnapshot = () => EMPTY;

export function useHilState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const storageSubscribe = (cb: () => void) => subscribe(cb);
export function useStorageOk() {
  return useSyncExternalStore(storageSubscribe, () => (load(), storageOk), () => true);
}

export function progressOf(s: HilState, key: string): PocProgress {
  return s[key] ?? { checked: [], verdict: null, feedback: "" };
}

export function updatePoc(key: string, fn: (p: PocProgress) => PocProgress) {
  load();
  state = { ...state, [key]: { ...fn(progressOf(state, key)), updatedAt: new Date().toISOString() } };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch {
    storageOk = false;
  }
  emit();
}

export function resetAll() {
  state = EMPTY;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    storageOk = false;
  }
  emit();
}
