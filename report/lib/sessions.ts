import "server-only";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseSessionRecord } from "@/fixtures/lib";
import type { SessionRecord } from "@/lib/types";
import { REPORT_DIR } from "./context";
import { readCachedReport, reportKey, REPORTS_DIR } from "./generate";
import type { SessionSummary } from "./types";

// Session sources (listed dynamically on every call):
//   fixture:sample          fixtures/sample-session.json
//   question:<file>         .data/question/sessions/*.json   (written by the question PoC, may appear later)
//   saved:<file>            .data/report/sessions/*.json     (pasted JSON in the /report UI)
//   sample:<file>           report/samples/session-*.json    (deliberately bad / good sessions for discrimination tests)

type Source = SessionSummary["source"];
const SOURCES: { source: Source; dir: string; match: (f: string) => boolean }[] = [
  { source: "question", dir: path.join(process.cwd(), ".data", "question", "sessions"), match: (f) => f.endsWith(".json") },
  { source: "saved", dir: path.join(REPORT_DIR, "sessions"), match: (f) => f.endsWith(".json") },
  { source: "sample", dir: path.join(process.cwd(), "report", "samples"), match: (f) => /^session-.+\.json$/.test(f) },
];
const FIXTURE = path.join(process.cwd(), "fixtures", "sample-session.json");
const REF_RE = /^(fixture|question|saved|sample):([\w.\-가-힣]+)$/;

const LABEL: Record<Source, string> = { fixture: "픽스처", question: "심사 질문 PoC", saved: "붙여넣기", sample: "리포트 테스트" };

async function readSession(file: string): Promise<SessionRecord | null> {
  try {
    return parseSessionRecord(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

function fileOf(ref: string): string | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  if (m[1] === "fixture") return m[2] === "sample" ? FIXTURE : null;
  const src = SOURCES.find((s) => s.source === m[1]);
  if (!src || m[2].includes("..")) return null;
  const f = path.join(src.dir, `${m[2]}.json`);
  return f.startsWith(src.dir + path.sep) ? f : null;
}

export async function getSession(ref: string): Promise<SessionRecord | null> {
  const f = fileOf(ref);
  return f ? readSession(f) : null;
}

async function summarize(ref: string, source: Source, s: SessionRecord): Promise<SessionSummary> {
  const key = reportKey(s);
  const cached = existsSync(path.join(REPORTS_DIR, `${key}.json`)) ? await readCachedReport(key) : null;
  return {
    id: ref,
    source,
    label: `${LABEL[source]} · ${s.id}`,
    situation: s.situation,
    presentationMinutes: s.presentationMinutes,
    qaMinutes: s.qaMinutes,
    sentences: s.transcript.length,
    questions: s.qa.length,
    createdAt: s.createdAt,
    reportKey: cached ? key : undefined,
    reportTotal: cached?.overall.total,
  };
}

export async function listSessions(): Promise<SessionSummary[]> {
  const out: SessionSummary[] = [];
  const fx = await readSession(FIXTURE);
  if (fx) out.push(await summarize("fixture:sample", "fixture", fx));
  for (const src of SOURCES) {
    let files: string[] = [];
    try {
      files = (await readdir(src.dir)).filter(src.match).sort();
    } catch {
      continue;
    }
    for (const f of files) {
      const s = await readSession(path.join(src.dir, f));
      if (s) out.push(await summarize(`${src.source}:${f.replace(/\.json$/, "")}`, src.source, s));
    }
  }
  return out;
}

/** Validate + persist a pasted SessionRecord. Returns its ref ("saved:<id>").
 *  Pasting the same id with DIFFERENT content never overwrites the earlier paste: it is stored as "<id>-<content hash>"
 *  (identical content → same ref, `duplicate: true`). `renamed` tells the UI to say so. */
export async function saveSession(data: unknown): Promise<{ ref: string; session: SessionRecord; renamed?: boolean; duplicate?: boolean }> {
  const session = parseSessionRecord(data);
  const base = session.id.replace(/[^\w\-가-힣]/g, "_").slice(0, 60) || "session";
  const dir = path.join(REPORT_DIR, "sessions");
  await mkdir(dir, { recursive: true });
  const body = JSON.stringify(session, null, 1);
  const same = async (stem: string) => (await readFile(path.join(dir, `${stem}.json`), "utf8").catch(() => null)) === body;
  if (!existsSync(path.join(dir, `${base}.json`)) || (await same(base))) {
    const duplicate = existsSync(path.join(dir, `${base}.json`));
    await writeFile(path.join(dir, `${base}.json`), body);
    return { ref: `saved:${base}`, session, duplicate };
  }
  const stem = `${base}-${createHash("sha256").update(body).digest("hex").slice(0, 6)}`;
  const duplicate = await same(stem);
  await writeFile(path.join(dir, `${stem}.json`), body);
  return { ref: `saved:${stem}`, session, renamed: true, duplicate };
}
