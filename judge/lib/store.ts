import "server-only";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JudgeRecord } from "./model";

export const DATA_DIR = path.join(process.cwd(), ".data", "judge");

const ID_RE = /^j_[a-z0-9]{6,32}$/;
export const isJudgeId = (id: string) => ID_RE.test(id);

export function newJudgeId() {
  const rand = crypto.getRandomValues(new Uint8Array(5));
  return `j_${Date.now().toString(36)}${Array.from(rand, (b) => (b % 36).toString(36)).join("")}`;
}

export const filePaths = (id: string) => ({
  json: path.join(DATA_DIR, `${id}.json`),
  image: path.join(DATA_DIR, `${id}.webp`),
  thumb: path.join(DATA_DIR, `${id}.thumb.webp`),
  card: path.join(DATA_DIR, `${id}.card.webp`), // 512px, derived lazily on first request
});

export type ImageVariant = "full" | "card" | "thumb";
export const CARD_PX = 512;

export async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function saveJudge(rec: JudgeRecord, image: Buffer, thumb: Buffer | null) {
  await ensureDir();
  const p = filePaths(rec.id);
  await writeFile(p.image, image);
  if (thumb) await writeFile(p.thumb, thumb);
  // JSON last: a judge is "listed" only once its image exists.
  await writeFile(p.json, JSON.stringify(rec, null, 2));
}

export async function readJudge(id: string): Promise<JudgeRecord | null> {
  if (!isJudgeId(id)) return null;
  try {
    return JSON.parse(await readFile(filePaths(id).json, "utf8")) as JudgeRecord;
  } catch {
    return null;
  }
}

export async function readAllJudges(): Promise<JudgeRecord[]> {
  let files: string[] = [];
  try {
    files = await readdir(DATA_DIR);
  } catch {
    return [];
  }
  const recs = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => readJudge(f.slice(0, -5))));
  return recs.filter((r): r is JudgeRecord => !!r).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function removeJudge(id: string): Promise<boolean> {
  if (!isJudgeId(id)) return false;
  const p = filePaths(id);
  const existed = !!(await readJudge(id));
  await Promise.all([p.json, p.image, p.thumb, p.card].map((f) => rm(f, { force: true })));
  return existed;
}

export async function readImage(id: string, variant: ImageVariant): Promise<Buffer | null> {
  if (!isJudgeId(id)) return null;
  const p = filePaths(id);
  if (variant === "card") return readCard(id);
  try {
    return await readFile(variant === "thumb" ? p.thumb : p.image);
  } catch {
    if (variant === "thumb") return readImage(id, "full"); // fall back if thumb missing
    return null;
  }
}

const cardJobs = new Map<string, Promise<Buffer | null>>();

/** 512px card image (gallery cards at DPR 2–3). Derived from the full image once, then cached on disk. */
async function readCard(id: string): Promise<Buffer | null> {
  const p = filePaths(id);
  try {
    return await readFile(p.card);
  } catch {}
  let job = cardJobs.get(id);
  if (!job) {
    job = (async () => {
      const full = await readImage(id, "full");
      if (!full) return null;
      try {
        const sharp = (await import("sharp")).default;
        const buf = await sharp(full).resize(CARD_PX, CARD_PX, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
        await writeFile(p.card, buf);
        return buf;
      } catch (e) {
        console.warn("[judge] card resize failed; serving full image", e);
        return full;
      }
    })().finally(() => cardJobs.delete(id));
    cardJobs.set(id, job);
  }
  return job;
}
