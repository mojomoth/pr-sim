import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile, appendFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractCitations, extractLinks, normalizeSlug, parseFrontmatter } from "./markdown";
import type { DocMeta, KeyNumber, LintReport, PageType, WikiDocSummary, WikiPageInfo, WikiStatus } from "./types";

// On-disk layout per document (Karpathy's three layers):
//   .data/wiki/<docId>/raw/      immutable sources: source.pdf, pages/NNN.txt, meta.json
//   .data/wiki/<docId>/wiki/     LLM-maintained markdown: SCHEMA.md, index.md, log.md, overview.md, 주요-수치.md, <slug>.md
//   .data/wiki/<docId>/state/    machine state: status.json, notes.json, plan.json, keynumbers.json, lint*.json

export const ROOT = path.join(process.cwd(), ".data", "wiki");
export const RESERVED = new Set(["index", "log", "schema", "overview", "주요-수치"]);

const DOC_ID_RE = /^[a-f0-9]{16}$/;
export function isDocId(s: string): boolean {
  return DOC_ID_RE.test(s);
}
export function docIdOf(buf: Buffer): { docId: string; sha256: string } {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  return { docId: sha256.slice(0, 16), sha256 };
}

export const docDir = (docId: string) => path.join(ROOT, docId);
export const rawDir = (docId: string) => path.join(ROOT, docId, "raw");
export const wikiDir = (docId: string) => path.join(ROOT, docId, "wiki");
export const stateDir = (docId: string) => path.join(ROOT, docId, "state");

function assertDoc(docId: string) {
  if (!isDocId(docId)) throw new Error(`invalid docId: ${docId}`);
}

export async function ensureDirs(docId: string) {
  assertDoc(docId);
  await mkdir(path.join(rawDir(docId), "pages"), { recursive: true });
  await mkdir(wikiDir(docId), { recursive: true });
  await mkdir(stateDir(docId), { recursive: true });
}

export async function writeAtomic(file: string, data: string | Buffer) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export const readMeta = (docId: string) => (isDocId(docId) ? readJson<DocMeta>(path.join(rawDir(docId), "meta.json")) : Promise.resolve(null));
export const readStatusFile = (docId: string) => (isDocId(docId) ? readJson<WikiStatus>(path.join(stateDir(docId), "status.json")) : Promise.resolve(null));
export const writeStatusFile = (s: WikiStatus) => writeAtomic(path.join(stateDir(s.docId), "status.json"), JSON.stringify(s, null, 1));
export const readState = <T>(docId: string, name: string) => readJson<T>(path.join(stateDir(docId), name));
export const writeState = (docId: string, name: string, v: unknown) => writeAtomic(path.join(stateDir(docId), name), JSON.stringify(v, null, 1));
export const readKeyNumbers = async (docId: string) => (await readState<KeyNumber[]>(docId, "keynumbers.json")) ?? [];
export const readLint = (docId: string, against?: string) => readState<LintReport>(docId, against ? `lint-vs-${against}.json` : "lint.json");

const pad = (n: number) => String(n).padStart(3, "0");
export async function writeRawPage(docId: string, page: number, text: string) {
  await writeFile(path.join(rawDir(docId), "pages", `${pad(page)}.txt`), text);
}
export async function readRawPage(docId: string, page: number): Promise<string | null> {
  if (!isDocId(docId) || !Number.isInteger(page) || page < 1 || page > 9999) return null;
  try {
    return await readFile(path.join(rawDir(docId), "pages", `${pad(page)}.txt`), "utf8");
  } catch {
    return null;
  }
}
export async function readAllRawPages(docId: string, pageCount: number): Promise<string[]> {
  return Promise.all(Array.from({ length: pageCount }, (_, i) => readRawPage(docId, i + 1).then((t) => t ?? "")));
}

// ---- wiki pages ----

/** Maps a slug (incl. reserved names) to its file. Returns null for unsafe slugs. */
export function pageFile(docId: string, slug: string): string | null {
  assertDoc(docId);
  const s = slug === "SCHEMA" ? "SCHEMA" : normalizeSlug(slug);
  if (!s || s.includes("..")) return null;
  const name = s === "schema" ? "SCHEMA" : s;
  return path.join(wikiDir(docId), `${name}.md`);
}

export async function readPage(docId: string, slug: string): Promise<string | null> {
  if (!isDocId(docId)) return null;
  const f = pageFile(docId, slug);
  if (!f) return null;
  try {
    return await readFile(f, "utf8");
  } catch {
    return null;
  }
}

export async function writePage(docId: string, slug: string, md: string) {
  const f = pageFile(docId, slug);
  if (!f) throw new Error(`unsafe slug: ${slug}`);
  await writeAtomic(f, md);
}

export async function appendLog(docId: string, entry: string) {
  await appendFile(path.join(wikiDir(docId), "log.md"), entry.endsWith("\n") ? entry : entry + "\n");
}

export async function listSlugs(docId: string): Promise<string[]> {
  if (!isDocId(docId)) return [];
  try {
    const files = await readdir(wikiDir(docId));
    return files.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3).normalize("NFC"));
  } catch {
    return [];
  }
}

export function pageInfoOf(slug: string, md: string): WikiPageInfo {
  const { fm, body } = parseFrontmatter(md);
  const title = fm.title ?? body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug;
  const type = (fm.type as PageType) ?? (slug === "index" || slug === "log" || slug === "SCHEMA" ? "meta" : "topic");
  const sources = fm.sources?.length ? fm.sources : extractCitations(body);
  return {
    slug,
    title,
    type,
    summary: String(fm.summary ?? ""),
    sources,
    links: extractLinks(body).filter((l) => l !== slug),
    chars: body.length,
    updated: fm.updated,
  };
}

/** Content pages (excludes index/log/SCHEMA), with parsed metadata. */
export async function listPages(docId: string, opts: { includeMeta?: boolean } = {}): Promise<WikiPageInfo[]> {
  const slugs = await listSlugs(docId);
  const infos = await Promise.all(
    slugs
      .filter((s) => opts.includeMeta || !["index", "log", "SCHEMA"].includes(s))
      .map(async (s) => {
        const md = await readPage(docId, s);
        return md == null ? null : pageInfoOf(s, md);
      }),
  );
  const order = (p: WikiPageInfo) => (p.slug === "overview" ? 0 : p.slug === "주요-수치" ? 1 : p.type === "analysis" ? 3 : 2);
  return infos.filter((x): x is WikiPageInfo => !!x).sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title, "ko"));
}

export async function listDocSummaries(): Promise<WikiDocSummary[]> {
  let ids: string[] = [];
  try {
    ids = (await readdir(ROOT)).filter(isDocId);
  } catch {
    return [];
  }
  const rows = await Promise.all(
    ids.map(async (docId): Promise<WikiDocSummary | null> => {
      const [meta, st] = await Promise.all([readMeta(docId), readStatusFile(docId)]);
      // a doc that failed before meta.json was written (e.g. broken PDF) is still listed from its status,
      // so the error stays visible after a reload and can be retried
      if (!meta && !st) return null;
      return {
        docId,
        filename: meta?.filename ?? st?.filename ?? "document.pdf",
        kind: meta?.kind ?? st?.kind ?? "proposal",
        pageCount: meta?.pageCount ?? st?.pageCount ?? 0,
        chars: meta?.chars ?? 0,
        state: st?.state ?? "queued",
        wikiPages: st?.wikiPages ?? 0,
        createdAt: meta?.createdAt ?? st?.startedAt ?? new Date(0).toISOString(),
        error: st?.state === "error" ? st.error : undefined,
      };
    }),
  );
  return rows.filter((r): r is WikiDocSummary => !!r).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function fileMtime(file: string): Promise<number> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}
