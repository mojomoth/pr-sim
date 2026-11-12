import "server-only";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionRecord } from "@/lib/types";
import type { QuestionRun } from "./types";

// .data/question/
//   runs/<runId>.json          QuestionRun (input + context pack + questions + QA log)
//   sessions/<id>.json         SessionRecord (lib/types contract — what the report PoC loads)
//   sessions/<id>.meta.json    extra details (questions, evidence, assessments) for the same session
//   lint/<a>-vs-<b>.json       cached wiki lint reports (cross-doc mismatches/gaps)
export const DATA_DIR = path.join(process.cwd(), ".data", "question");
const RUNS = path.join(DATA_DIR, "runs");
const SESSIONS = path.join(DATA_DIR, "sessions");
export const LINT_DIR = path.join(DATA_DIR, "lint");

export const isRunId = (id: string) => /^r_[a-z0-9]+$/.test(id);
export const isSessionId = (id: string) => /^qs_[a-z0-9]+$/.test(id);
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}
export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export const saveRun = (run: QuestionRun) => writeJson(path.join(RUNS, `${run.id}.json`), run);
export const loadRun = (id: string) => (isRunId(id) ? readJson<QuestionRun>(path.join(RUNS, `${id}.json`)) : Promise.resolve(null));

export async function saveSessionFiles(rec: SessionRecord, meta: unknown): Promise<{ file: string }> {
  const file = path.join(SESSIONS, `${rec.id}.json`);
  await writeJson(file, rec);
  await writeJson(path.join(SESSIONS, `${rec.id}.meta.json`), meta);
  return { file: path.relative(process.cwd(), file) };
}

export async function listSessions(): Promise<{ id: string; createdAt: string; situation: string; qa: number; judges: string[] }[]> {
  let names: string[] = [];
  try {
    names = (await readdir(SESSIONS)).filter((n) => /^qs_[a-z0-9]+\.json$/.test(n));
  } catch {
    return [];
  }
  const out = await Promise.all(
    names.map(async (n) => {
      const r = await readJson<SessionRecord>(path.join(SESSIONS, n));
      return r ? { id: r.id, createdAt: r.createdAt, situation: r.situation.slice(0, 80), qa: r.qa.length, judges: r.judges.map((j) => j.name) } : null;
    }),
  );
  return out.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadSession(id: string): Promise<{ record: SessionRecord; meta: unknown } | null> {
  if (!isSessionId(id)) return null;
  const record = await readJson<SessionRecord>(path.join(SESSIONS, `${id}.json`));
  if (!record) return null;
  return { record, meta: await readJson(path.join(SESSIONS, `${id}.meta.json`)) };
}

export interface RunSummary {
  id: string;
  createdAt: string;
  situation: string;
  judges: { name: string; temperament: string }[];
  questions: number;
  provider?: string;
  qa: number;
}

/** Saved generation runs, newest first (for the "저장된 실행 불러오기" replay mode). */
export async function listRuns(limit = 30): Promise<RunSummary[]> {
  let names: string[] = [];
  try {
    names = (await readdir(RUNS)).filter((n) => /^r_[a-z0-9]+\.json$/.test(n));
  } catch {
    return [];
  }
  const out = await Promise.all(
    names.map(async (n): Promise<RunSummary | null> => {
      const r = await readJson<QuestionRun>(path.join(RUNS, n));
      if (!r?.questions?.length) return null;
      const u = r.usage?.[0];
      return {
        id: r.id,
        createdAt: r.createdAt,
        situation: (r.input.situation ?? "").slice(0, 60),
        judges: r.input.judges.map((j) => ({ name: j.name, temperament: j.temperament })),
        questions: r.questions.filter((q) => q.kind !== "followup").length,
        provider: u ? `${u.provider}:${u.model}` : undefined,
        qa: r.qa?.length ?? 0,
      };
    }),
  );
  return out.filter((x): x is RunSummary => !!x).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
