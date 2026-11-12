"use client";
// Typed session + blob access on top of platform storage (IndexedDB "pr-sim").
import { useEffect, useState } from "react";
import { platform } from "@/platform";
import type { SessionRecord } from "./types";

const { storage } = platform;

export const blobKey = {
  pdf: (docId: string) => `pdf:${docId}`,
  judge: (judgeId: string) => `judge:${judgeId}`,
  judgeThumb: (judgeId: string) => `judge:${judgeId}:thumb`,
};

function newId(prefix: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

export async function createSession(setup: SessionRecord["setup"]): Promise<SessionRecord> {
  const now = new Date().toISOString();
  const rec: SessionRecord = { id: newId("s_"), status: "setup", setup, docs: {}, judges: [], transcript: [], qa: [], createdAt: now, updatedAt: now };
  await storage.putSession(rec);
  return rec;
}

/** undefined when the id is unknown (deep link to a deleted / other-device session). */
export function getSession(id: string): Promise<SessionRecord | undefined> {
  return storage.getSession<SessionRecord>(id);
}

/** Newest first (by updatedAt). */
export async function listSessions(): Promise<SessionRecord[]> {
  const all = await storage.listSessions<SessionRecord>();
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Atomic read-modify-write; stamps updatedAt. `patch` is merged shallowly, or a function gets the
 * current record and returns the next one. Throws if the session does not exist.
 */
export function updateSession(id: string, patch: Partial<SessionRecord> | ((cur: SessionRecord) => SessionRecord)): Promise<SessionRecord> {
  return storage.updateSession<SessionRecord>(id, (cur) => {
    if (!cur) throw new Error("기록을 찾을 수 없어요.");
    const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
    return { ...next, id, updatedAt: new Date().toISOString() };
  });
}

/** Delete a session with its judge photos, and its PDFs unless another session uses the same file. */
export async function deleteSession(id: string): Promise<void> {
  const all = await storage.listSessions<SessionRecord>();
  const rec = all.find((s) => s.id === id);
  if (!rec) return;
  const pdfKeysElsewhere = new Set(
    all.filter((s) => s.id !== id).flatMap((s) => [s.docs.presentation?.pdfKey, s.docs.proposal?.pdfKey].filter((k): k is string => !!k)),
  );
  const keys = [
    ...rec.judges.flatMap((j) => [j.imageKey, j.thumbKey]),
    ...[rec.docs.presentation?.pdfKey, rec.docs.proposal?.pdfKey].filter((k): k is string => !!k && !pdfKeysElsewhere.has(k)),
  ];
  await storage.deleteSession(id, keys);
}

export const getBlob = storage.getBlob;
export const deleteBlob = storage.deleteBlob;

/** Store an uploaded PDF under "pdf:<docId>" and return the key. */
export async function storePdf(docId: string, file: Blob): Promise<string> {
  const key = blobKey.pdf(docId);
  await storage.putBlob(key, file);
  return key;
}

/** 256px square thumbnail (webp where the browser can encode it, else png). */
async function makeThumb(blob: Blob, px = 256): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const side = Math.min(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, px, px);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? blob), "image/webp", 0.85));
  } finally {
    bmp.close();
  }
}

/** Save a generated judge photo (base64 from /api/judges) + its thumbnail. Returns the blob keys. */
export async function storeJudgeImage(judgeId: string, image: { mime: string; base64: string }): Promise<{ imageKey: string; thumbKey: string }> {
  const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
  const full = new Blob([bytes], { type: image.mime });
  const thumb = await makeThumb(full).catch(() => full);
  const imageKey = blobKey.judge(judgeId);
  const thumbKey = blobKey.judgeThumb(judgeId);
  await Promise.all([storage.putBlob(imageKey, full), storage.putBlob(thumbKey, thumb)]);
  return { imageKey, thumbKey };
}

/** Object URL for a stored blob (judge photo, PDF), revoked on change/unmount. undefined while loading or missing. */
export function useBlobUrl(key: string | undefined): string | undefined {
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let made: string | null = null;
    storage
      .getBlob(key)
      .then((b) => {
        if (cancelled || !b) return;
        made = URL.createObjectURL(b);
        setUrl({ key, url: made });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [key]);
  return url && url.key === key ? url.url : undefined;
}
