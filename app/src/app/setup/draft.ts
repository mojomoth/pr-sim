"use client";
// Setup drafts: one SessionRecord in status "setup" holds the form, so going back never loses input.
// Also used by /history (다시 시작하기) and by the background wiki builds started from /setup.
import { platform } from "@/platform";
import { ApiError, streamWiki } from "@/features/session/api";
import { blobKey, createSession, getBlob, listSessions, updateSession } from "@/features/session/db";
import type { DocRole, SessionRecord, StoredDoc, StoredJudge } from "@/features/session/types";

export const DEFAULT_SETUP: SessionRecord["setup"] = { situation: "", presentationMinutes: 15, qaMinutes: 20 };

/** A session the presenter has not really started yet can go back to being a draft. */
export function hasProgress(rec: SessionRecord): boolean {
  return rec.transcript.length > 0 || rec.qa.length > 0 || !!rec.questions || !!rec.report || !!rec.resume;
}

/** Most recent untouched draft, if any. */
export async function latestDraft(): Promise<SessionRecord | undefined> {
  return (await listSessions()).find((s) => s.status === "setup");
}

function judgeId(): string {
  return `j_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * New draft with the same setup, documents (wiki included) and judges. Judge photos are copied under
 * new ids so deleting either session never removes the other one's faces; PDFs are shared (deleteSession
 * keeps a PDF another session still uses).
 */
export async function cloneAsDraft(src: SessionRecord): Promise<SessionRecord> {
  const judges: StoredJudge[] = await Promise.all(
    src.judges.map(async (j) => {
      const id = judgeId();
      const [img, thumb] = await Promise.all([j.imageKey ? getBlob(j.imageKey) : undefined, j.thumbKey ? getBlob(j.thumbKey) : undefined]);
      const imageKey = img ? blobKey.judge(id) : "";
      const thumbKey = thumb ? blobKey.judgeThumb(id) : "";
      await Promise.all([img && platform.storage.putBlob(imageKey, img), thumb && platform.storage.putBlob(thumbKey, thumb)]);
      return { ...j, id, imageKey, thumbKey };
    }),
  );
  const rec = await createSession({ ...src.setup });
  // A wiki that never finished in the source is rebuilt when the draft opens.
  const docs: SessionRecord["docs"] = {};
  for (const role of ["presentation", "proposal"] as const) {
    const d = src.docs[role];
    if (d) docs[role] = d.wikiState === "ready" ? d : { ...d, wikiState: "pending", wikiError: undefined };
  }
  return updateSession(rec.id, { docs, judges });
}

/** Judge used when face generation failed and the presenter starts anyway (initial instead of a photo). */
const FALLBACK_NAMES = [
  { name: "지훈", fullName: "김지훈", gender: "male" },
  { name: "수진", fullName: "이수진", gender: "female" },
  { name: "현석", fullName: "박현석", gender: "male" },
  { name: "은정", fullName: "최은정", gender: "female" },
] as const;
export function fallbackJudge(temperament: StoredJudge["temperament"], taken: StoredJudge[]): StoredJudge {
  const used = new Set(taken.flatMap((j) => [j.name, j.fullName[0]]));
  const pick = FALLBACK_NAMES.find((n) => !used.has(n.name) && !used.has(n.fullName[0])) ?? FALLBACK_NAMES.find((n) => !used.has(n.name)) ?? FALLBACK_NAMES[0];
  return { id: judgeId(), temperament, ...pick, age: 45, voiceHint: "", imageKey: "", thumbKey: "" };
}

// ── Background wiki builds ──
// A build keeps running after the setup screen unmounts (client-side navigation to /present), and writes
// its result into the session. Progress is kept here so a remounted setup screen can show it again.

export interface WikiProgress {
  done: number;
  total: number;
}
const jobs = new Map<string, WikiProgress>();
const listeners = new Set<() => void>();
const jobKey = (sessionId: string, doc: Pick<StoredDoc, "role" | "docId">) => `${sessionId}:${doc.role}:${doc.docId}`;

export function wikiProgress(sessionId: string, doc: StoredDoc): WikiProgress | undefined {
  return jobs.get(jobKey(sessionId, doc));
}
/** Called after any job update (progress, finished, failed). Returns the unsubscribe function. */
export function onWikiChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

/** Write to the doc only if it is still the same file (it may have been replaced or removed meanwhile). */
function patchDoc(sessionId: string, role: DocRole, docId: string, patch: Partial<StoredDoc>) {
  return updateSession(sessionId, (cur) => {
    const d = cur.docs[role];
    if (!d || d.docId !== docId) return cur;
    return { ...cur, docs: { ...cur.docs, [role]: { ...d, ...patch } } };
  });
}

/** Build the wiki for one document of a session (no-op if a build for it is already running in this tab). */
export async function buildWiki(sessionId: string, doc: StoredDoc): Promise<void> {
  const key = jobKey(sessionId, doc);
  if (jobs.has(key)) return;
  jobs.set(key, { done: 0, total: 0 });
  notify();
  try {
    await patchDoc(sessionId, doc.role, doc.docId, { wikiState: "building", wikiError: undefined, wikiDegraded: undefined, wikiModel: undefined });
    const done = await streamWiki(
      { role: doc.role, docId: doc.docId, filename: doc.filename, pageTexts: doc.pageTexts },
      {
        onEvent: (e) => {
          if (e.type !== "progress") return;
          // extract chunks first, then merge rounds: one bar over both.
          jobs.set(key, { done: e.chunksDone + e.roundsDone, total: e.chunksTotal + e.roundsTotal });
          notify();
        },
      },
    );
    // degraded: a last-resort lite model wrote some pages; keep which one so the setup row can say so.
    const models = [...new Set(Object.keys(done.usage ?? {}).map((k) => k.split(":").pop() ?? k))];
    const lite = models.filter((m) => /lite/i.test(m));
    await patchDoc(sessionId, doc.role, doc.docId, {
      wikiState: "ready",
      wiki: done.wiki,
      keyNumbers: done.keyNumbers,
      wikiBuiltAt: new Date().toISOString(),
      wikiDegraded: done.degraded ? true : undefined,
      wikiModel: done.degraded ? (lite.length ? lite : models).join(", ") || undefined : undefined,
    });
  } catch (e) {
    const message = e instanceof ApiError ? e.message : "자료를 분석하지 못했어요. 다시 시도해 주세요.";
    await patchDoc(sessionId, doc.role, doc.docId, { wikiState: "error", wikiError: message }).catch(() => {});
  } finally {
    jobs.delete(key);
    notify();
  }
}
