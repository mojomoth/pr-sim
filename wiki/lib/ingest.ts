import "server-only";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { friendlyLlmError, nextStep } from "./errors";
import { LlmUnavailableError, llmJson, pool, probeLlm, providerNote, withRetry, type CallUsage } from "./llm";
import { buildFrontmatter, compactPages, extractCitations, normalizeSlug, parseFrontmatter } from "./markdown";
import { verifyKeyNumbers } from "./numbers-verify";
import { checkableFigures, normRaw, pageSummary, regroundCitations } from "./reground";
import {
  ExtractSchema,
  NumbersSchema,
  OverviewSchema,
  PlanSchema,
  WriteSchema,
  extractPrompt,
  numbersPrompt,
  overviewPrompt,
  planPrompt,
  schemaDoc,
  writePrompt,
  type ExtractNotes,
  type Plan,
  type WriteOp,
} from "./prompts";
import {
  RESERVED,
  PREV,
  STAGE,
  appendLog,
  docDir,
  docIdOf,
  ensureDirs,
  isDocId,
  liveStateDir,
  liveWikiDir,
  listPages,
  rawDir,
  readAllRawPages,
  readKeyNumbers,
  readMeta,
  readPage,
  readStatusFile,
  runStaged,
  stateDir,
  wikiDir,
  writeAtomic,
  writePage,
  writeRawPage,
  writeState,
  writeStatusFile,
} from "./store";
import type { DocKind, DocMeta, IngestEvent, KeyNumber, PageType, WikiState, WikiStatus } from "./types";

export interface IngestOptions {
  kind?: DocKind;
  force?: boolean; // rebuild even if a ready wiki exists for this content hash
  onProgress?: (e: IngestEvent, status: WikiStatus) => void;
}

// ---------------------------------------------------------------- job registry (survives HMR)

type Listener = NonNullable<IngestOptions["onProgress"]>;
interface Job {
  promise: Promise<void>;
  listeners: Set<Listener>;
}
const g = globalThis as unknown as { __wikiJobs?: Map<string, Job> };
const jobs = (g.__wikiJobs ??= new Map<string, Job>());

export function isRunning(docId: string): boolean {
  return jobs.has(docId);
}

/** Start (or join) ingestion in the background. Same bytes → same docId; a ready wiki is reused. */
export async function startIngest(buf: Buffer, filename: string, opts: IngestOptions = {}): Promise<{ docId: string; reused: boolean }> {
  if (!buf.length || buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("PDF 파일이 아닙니다");
  const { docId, sha256 } = docIdOf(buf);
  return startJob(docId, sha256, buf, filename, opts);
}

async function startJob(docId: string, sha256: string, buf: Buffer, filename: string, opts: IngestOptions): Promise<{ docId: string; reused: boolean }> {
  const existing = jobs.get(docId);
  if (existing) {
    if (opts.onProgress) existing.listeners.add(opts.onProgress);
    return { docId, reused: true };
  }
  const st = await readStatusFile(docId);
  if (st?.state === "ready" && !opts.force) return { docId, reused: true };
  const listeners = new Set<Listener>(opts.onProgress ? [opts.onProgress] : []);
  const job: Job = { listeners, promise: Promise.resolve() };
  jobs.set(docId, job);
  // resolve once the initial status is on disk, so a client that reloads right after the 202 already sees the job
  // (state "queued", or a ready status with `rebuild` for a reingest of a ready wiki)
  let started!: () => void;
  const initialSaved = new Promise<void>((r) => (started = r));
  job.promise = runIngest(docId, sha256, buf, safeName(filename), opts.kind, listeners, started)
    .catch(() => {
      /* error already recorded in status.json */
    })
    .finally(() => {
      started();
      jobs.delete(docId);
    });
  await initialSaved;
  return { docId, reused: false };
}

/** Rebuild a wiki from its stored immutable source (raw/source.pdf).
 *  A READY wiki is rebuilt in staging dirs and swapped in only on success — until then (and after a failure) the
 *  current wiki stays readable/queryable and status.json stays "ready" (progress in `status.rebuild`, a failure in
 *  `status.lastReingestError`). A doc in error state is rebuilt in place, as before.
 *  Preflight: throws LlmUnavailableError (HTTP 503) when no AI provider can be called, so nothing is started. */
export async function reingest(docId: string, opts: { preflight?: boolean } = {}): Promise<{ docId: string; reused: boolean }> {
  // meta.json is missing when the first attempt failed during text extraction → fall back to status.json
  const [meta, st] = await Promise.all([readMeta(docId), readStatusFile(docId)]);
  if (!meta && !st) throw new Error(`unknown docId ${docId}`);
  if (jobs.has(docId)) return { docId, reused: true };
  const buf = await readFile(path.join(rawDir(docId), "source.pdf")).catch(() => null);
  if (!buf) throw new Error("원본 PDF가 저장되지 않았습니다(이전 버전에서 실패한 문서). 파일을 다시 올려 주세요");
  if (opts.preflight !== false) {
    try {
      await probeLlm();
    } catch (e) {
      if (!(e instanceof LlmUnavailableError)) throw e;
      const keep = st?.state === "ready" ? " 지금 위키는 그대로 유지됩니다." : "";
      const err = new LlmUnavailableError(e.code, e.detail);
      err.message = `지금은 사용할 수 있는 AI 제공자가 없어 위키를 다시 만들 수 없습니다 (${e.detail}).${keep} ${nextStep(e.code)}`;
      throw err;
    }
  }
  // the job keeps THIS docId (not the hash of the bytes) so a copied/renamed doc dir never rebuilds another doc
  return startJob(docId, meta?.sha256 ?? docIdOf(buf).sha256, buf, meta?.filename ?? st!.filename, { kind: meta?.kind, force: true });
}

/** Delete a document (raw source, wiki, state). Refused while its ingest/rebuild job runs. */
export async function deleteDoc(docId: string): Promise<{ docId: string; deleted: true }> {
  if (!isDocId(docId)) throw new Error(`invalid docId: ${docId}`);
  const [meta, st] = await Promise.all([readMeta(docId), readStatusFile(docId)]);
  if (!meta && !st) throw new Error(`unknown docId ${docId}`);
  if (jobs.has(docId)) throw new Error("위키를 만드는 중이라 삭제할 수 없습니다. 끝난 뒤 다시 시도하세요");
  // rename first so a concurrent reader never sees a half-deleted dir, then remove
  const trash = `${docDir(docId)}.deleting-${Date.now()}`;
  await rename(docDir(docId), trash);
  await rm(trash, { recursive: true, force: true });
  return { docId, deleted: true };
}

/** Ingest and wait until the wiki is ready. Throws if ingestion failed. */
export async function ingestPdf(buf: Buffer, filename: string, opts: IngestOptions = {}): Promise<{ docId: string; reused: boolean }> {
  const r = await startIngest(buf, filename, opts);
  await waitForWiki(r.docId);
  return r;
}

export async function waitForWiki(docId: string): Promise<WikiStatus> {
  // a rebuild of a ready wiki does not block readers: the live wiki is ready the whole time
  if ((await readStatusFile(docId))?.state !== "ready") await jobs.get(docId)?.promise;
  const st = await readStatusFile(docId);
  if (!st) throw new Error(`unknown docId ${docId}`);
  if (st.state === "error") throw new Error(`wiki ingest failed: ${st.error}`);
  if (st.state !== "ready") throw new Error(`wiki not ready (${st.state}) and no job running`);
  return st;
}

/** Status with stale-job detection (e.g. dev server restarted mid-ingest). */
export async function getWikiStatus(docId: string): Promise<WikiStatus | null> {
  const raw = await readStatusFile(docId);
  if (!raw) return null;
  const st = { ...raw, provider: tidyProvider(raw.provider) };
  if (st.state !== "ready" && st.state !== "error" && !jobs.has(docId)) {
    return { ...st, state: "error", error: "중단됨 (서버 재시작 등) — 같은 PDF를 다시 올리면 처음부터 다시 만듭니다" };
  }
  if (st.rebuild && !jobs.has(docId)) {
    const { rebuild, ...rest } = st;
    return { ...rest, lastReingestError: "다시 만들기가 중단됐습니다 (서버 재시작 등). 지금 위키는 그대로입니다.", lastReingestAt: rebuild.updatedAt };
  }
  return st;
}

/** Display name only (never used as a path): keep Korean, spaces and normal punctuation like "(30-45)". */
function safeName(name: string) {
  const base = (name || "document.pdf").normalize("NFC").split(/[\\/]/).pop() ?? "";
  return (base.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, "_").trim() || "document.pdf").slice(0, 120);
}

/** Older status files stored the raw provider error (JSON); show a short label instead. */
function tidyProvider(p: string | undefined): string | undefined {
  if (!p || (p.length <= 60 && !p.includes("{"))) return p;
  const m = /^(.*?\(claude 비활성: )/.exec(p);
  return m ? `${m[1]}${/usage limit/i.test(p) ? "사용 한도 초과" : "사용 불가"})` : p.slice(0, 60) + "…";
}

// ---------------------------------------------------------------- status tracker

function nowStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

class Tracker {
  s: WikiStatus;
  /** How a snapshot is written (default: live status.json; a rebuild nests it under the live ready status). */
  persist: (snap: WikiStatus) => Promise<void> = (snap) => writeStatusFile(snap);
  private chain = Promise.resolve();
  private phaseStart = Date.now();
  constructor(
    init: WikiStatus,
    readonly listeners: Set<Listener>,
  ) {
    this.s = init;
  }
  save() {
    this.s.updatedAt = new Date().toISOString();
    const snap = JSON.parse(JSON.stringify(this.s)) as WikiStatus;
    this.chain = this.chain.then(() => this.persist(snap)).catch(() => {});
    return this.chain;
  }
  /** Wait for queued writes, then stop writing (the caller writes the final status itself). */
  async close() {
    this.persist = async () => {};
    await this.chain;
  }
  phase(state: WikiState, msg: string) {
    const prev = this.s.state;
    if (prev !== "queued" && prev !== state && prev !== "ready" && prev !== "error") {
      this.s.timings[prev as "extracting"] = Date.now() - this.phaseStart;
    }
    this.phaseStart = Date.now();
    this.s.state = state;
    this.event({ msg });
  }
  event(e: Omit<IngestEvent, "ts" | "phase">) {
    const ev: IngestEvent = { ts: new Date().toISOString(), phase: this.s.state, ...e };
    this.s.events.push(ev);
    if (this.s.events.length > 300) this.s.events.splice(0, this.s.events.length - 300);
    void this.save();
    for (const l of this.listeners) {
      try {
        l(ev, this.s);
      } catch {
        /* listener errors are not ours */
      }
    }
  }
  usage = (u: CallUsage) => {
    const k = `${u.provider}:${u.model}`;
    const cur = (this.s.usage[k] ??= { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0 });
    cur.calls++;
    cur.inputTokens += u.inputTokens;
    cur.outputTokens += u.outputTokens;
    cur.ms += u.ms;
    this.s.provider = providerNote();
  };
}

// ---------------------------------------------------------------- pipeline

interface Chunk {
  i: number;
  pages: { n: number; text: string }[];
}

function makeChunks(texts: string[]): Chunk[] {
  const maxPages = texts.length <= 16 ? 6 : 8;
  const maxChars = 14000;
  const chunks: Chunk[] = [];
  let cur: Chunk["pages"] = [];
  let chars = 0;
  texts.forEach((text, idx) => {
    if (cur.length && (cur.length >= maxPages || chars + text.length > maxChars)) {
      chunks.push({ i: chunks.length, pages: cur });
      cur = [];
      chars = 0;
    }
    cur.push({ n: idx + 1, text });
    chars += text.length;
  });
  if (cur.length) chunks.push({ i: chunks.length, pages: cur });
  return chunks;
}

const cleanText = (t: string) =>
  t
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

async function guessKind(buf: Buffer, pageCount: number): Promise<DocKind> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const page = await pdf.getPage(1);
    const [x0, y0, x1, y1] = page.view;
    return x1 - x0 > y1 - y0 ? "presentation" : "proposal";
  } catch {
    return pageCount <= 30 ? "presentation" : "proposal";
  }
}

type Fact = { claim: string; pages: number[] };

async function runIngest(docId: string, sha256: string, buf: Buffer, filename: string, kindOpt: DocKind | undefined, listeners: Set<Listener>, started: () => void) {
  const t0 = Date.now();
  const prev = await readStatusFile(docId);
  // a READY wiki with pages is rebuilt in staging and swapped in only on success; anything else is built in place
  const rebuild = prev?.state === "ready" && (await listPages(docId)).length > 0;
  if (!rebuild) await ensureDirs(docId);
  const tr = new Tracker(
    {
      docId,
      state: "queued",
      filename,
      kind: kindOpt ?? "proposal",
      pageCount: 0,
      chunksTotal: 0,
      chunksDone: 0,
      roundsTotal: 0,
      roundsDone: 0,
      pagesCreated: 0,
      pagesUpdated: 0,
      wikiPages: 0,
      usage: {},
      timings: {},
      events: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provider: providerNote(),
    },
    listeners,
  );
  if (rebuild) return runRebuild(docId, sha256, buf, filename, kindOpt, tr, prev!, t0, started);
  await tr.save(); // status exists (queued) before anything is cleared → no 404 window for pollers
  started();

  try {
    // first ingest / retry of a failed doc: clear the LLM-maintained layer + derived state (raw/ stays immutable)
    await rm(wikiDir(docId), { recursive: true, force: true });
    for (const f of await readdir(stateDir(docId))) if (f !== "status.json") await rm(path.join(stateDir(docId), f), { force: true });
    await ensureDirs(docId);
    await buildWiki(docId, sha256, buf, filename, kindOpt, tr, t0, false);
    tr.phase("ready", `완료: 위키 ${tr.s.wikiPages}페이지 · ${(tr.s.timings.total! / 1000).toFixed(1)}초`);
    await tr.save();
  } catch (e) {
    tr.s.error = friendlyLlmError(e);
    tr.s.timings.total = Date.now() - t0;
    tr.phase("error", `실패: ${tr.s.error}`);
    await appendLog(docId, `## [${nowStamp()}] ingest | 실패 | ${tr.s.error}\n`).catch(() => {});
    await tr.save();
    throw e;
  }
}

const rmStaging = (docId: string) =>
  Promise.all([liveWikiDir(docId), liveStateDir(docId)].flatMap((d) => [rm(d + STAGE, { recursive: true, force: true }), rm(d + PREV, { recursive: true, force: true })]));

/** Reingest of a ready wiki: build into wiki.next/ + state.next/, swap in on success, keep the old wiki on failure. */
async function runRebuild(docId: string, sha256: string, buf: Buffer, filename: string, kindOpt: DocKind | undefined, tr: Tracker, prev: WikiStatus, t0: number, started: () => void) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rebuild: _stale, ...base } = prev;
  // the live status stays "ready" (queries, lint, question/report keep working); the new build's progress is nested
  tr.persist = (snap) => writeStatusFile({ ...base, rebuild: snap });
  tr.s.kind = kindOpt ?? prev.kind;
  tr.s.pageCount = prev.pageCount;
  await rmStaging(docId);
  await tr.save();
  started();
  try {
    const built = await runStaged(docId, async () => {
      await ensureDirs(docId); // → wiki.next/, state.next/
      return buildWiki(docId, sha256, buf, filename, kindOpt, tr, t0, true);
    });
    await commitRebuild(docId, tr, built);
  } catch (e) {
    const msg = friendlyLlmError(e);
    await tr.close();
    await rmStaging(docId);
    const cur: WikiStatus = (await readStatusFile(docId)) ?? base;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { rebuild: _r, ...live } = cur;
    const now = new Date().toISOString();
    await writeStatusFile({ ...live, state: "ready", lastReingestError: msg, lastReingestAt: now, updatedAt: now });
    await appendLog(docId, `## [${nowStamp()}] ingest | 다시 만들기 실패 — 기존 위키 유지 | ${msg}\n`).catch(() => {});
    const ev: IngestEvent = { ts: now, phase: "error", msg: `다시 만들기 실패(기존 위키 유지): ${msg}` };
    for (const l of tr.listeners) {
      try {
        l(ev, { ...tr.s, state: "error", error: msg });
      } catch {
        /* listener errors are not ours */
      }
    }
    throw e;
  }
}

/** Swap the staged build in: raw text + meta (atomic per file), merged log, final status, then dir renames. */
async function commitRebuild(docId: string, tr: Tracker, built: { texts: string[]; meta: DocMeta }) {
  const pad = (n: number) => String(n).padStart(3, "0");
  // same source bytes → normally identical text; written atomically because readers use raw/ during the rebuild
  for (const [i, t] of built.texts.entries()) await writeAtomic(path.join(rawDir(docId), "pages", `${pad(i + 1)}.txt`), t);
  await writeAtomic(path.join(rawDir(docId), "meta.json"), JSON.stringify(built.meta, null, 1));
  const W = liveWikiDir(docId);
  const S = liveStateDir(docId);
  // log.md is append-only history: keep the old entries, then this build's; carry the query sidecar over
  const [oldLog, newLog] = await Promise.all([readFile(path.join(W, "log.md"), "utf8").catch(() => ""), readFile(path.join(W + STAGE, "log.md"), "utf8").catch(() => "")]);
  const at = newLog.indexOf("\n## [");
  if (oldLog && at >= 0) await writeAtomic(path.join(W + STAGE, "log.md"), oldLog.trimEnd() + "\n" + newLog.slice(at));
  await copyFile(path.join(W, "log-queries.md"), path.join(W + STAGE, "log-queries.md")).catch(() => {});
  tr.phase("ready", `완료: 위키 ${tr.s.wikiPages}페이지 · ${((tr.s.timings.total ?? 0) / 1000).toFixed(1)}초 (다시 만들기 — 새 위키로 교체)`);
  await tr.close();
  await writeStatusFile({ ...tr.s, state: "ready", updatedAt: new Date().toISOString() }, S + STAGE);
  await swapIn(W);
  try {
    await swapIn(S);
  } catch (e) {
    // put the old wiki back so wiki/ and state/ stay consistent
    await rename(W, W + STAGE).catch(() => {});
    await rename(W + PREV, W).catch(() => {});
    throw e;
  }
  await Promise.all([rm(W + PREV, { recursive: true, force: true }), rm(S + PREV, { recursive: true, force: true })]);
}

/** live → live.prev, live.next → live (each rename is atomic; the gap between them is microseconds). */
async function swapIn(live: string) {
  await rm(live + PREV, { recursive: true, force: true });
  await mkdir(live, { recursive: true });
  await rename(live, live + PREV);
  try {
    await rename(live + STAGE, live);
  } catch (e) {
    await rename(live + PREV, live).catch(() => {});
    throw e;
  }
}

/** The ingest pipeline (RAW → EXTRACT → PLAN → MERGE → FINALIZE). With `staged`, wiki/state writes go to the staging
 *  dirs (via runStaged) and raw/ is left untouched: its text + meta are returned for commitRebuild. */
async function buildWiki(docId: string, sha256: string, buf: Buffer, filename: string, kindOpt: DocKind | undefined, tr: Tracker, t0: number, staged: boolean) {
  {
    // ---- RAW: immutable source layer
    tr.phase("extracting", "PDF 텍스트 추출 중");
    const tx = Date.now();
    // store the immutable source first so a failed extraction can still be retried from the UI
    if (!staged) await writeFile(path.join(rawDir(docId), "source.pdf"), buf);
    const { totalPages, text } = await extractText(new Uint8Array(buf), { mergePages: false });
    const texts = text.map(cleanText);
    const kind = kindOpt ?? (await guessKind(buf, totalPages));
    if (!staged) await Promise.all(texts.map((t, i) => writeRawPage(docId, i + 1, t)));
    const meta: DocMeta = {
      docId,
      filename,
      kind,
      sha256,
      pageCount: totalPages,
      chars: texts.reduce((a, t) => a + t.length, 0),
      emptyPages: texts.map((t, i) => (t.replace(/\s/g, "").length < 20 ? i + 1 : 0)).filter(Boolean),
      bytes: buf.length,
      createdAt: (await readMeta(docId))?.createdAt ?? new Date().toISOString(),
    };
    if (!staged) await writeAtomic(path.join(rawDir(docId), "meta.json"), JSON.stringify(meta, null, 1));
    tr.s.kind = kind;
    tr.s.pageCount = totalPages;
    tr.s.timings.extract = Date.now() - tx;
    if (meta.chars < 50) throw new Error("추출 가능한 텍스트가 없습니다(스캔 PDF는 이 PoC에서 OCR 미지원)");

    await writePage(docId, "SCHEMA", schemaDoc(kind, filename));
    await writeAtomic(
      path.join(wikiDir(docId), "log.md"),
      `---\ntitle: "작업 기록"\ntype: "meta"\n---\n# log — ${filename}\n\n> 추가만 하는 작업 기록. \`grep "^## \\[" log.md\` 로 훑을 수 있다.\n\n> 질의(query) 호출 전체 기록은 [[log-queries]]에 있다. 여기에는 답변이 생성·저장된 질의만 남긴다.\n\n`,
    );
    await appendLog(docId, `## [${nowStamp()}] ingest | ${staged ? "다시 만들기 시작(스테이징)" : "시작"} | ${filename} · ${totalPages}쪽 · ${meta.chars.toLocaleString()}자 · kind=${kind}${meta.emptyPages.length ? ` · 빈 쪽 ${compactPages(meta.emptyPages)}` : ""}\n`);

    // ---- 1) EXTRACT: per-chunk notes, parallel
    const chunks = makeChunks(texts);
    tr.s.chunksTotal = chunks.length;
    tr.event({ msg: `${totalPages}쪽 → ${chunks.length}개 청크로 나눠 병렬 추출 시작`, chunksTotal: chunks.length });
    const notes = await pool(chunks, 8, async (c) => {
      const range = `p.${c.pages[0].n}–${c.pages[c.pages.length - 1].n}`;
      const lo = c.pages[0].n;
      const hi = c.pages[c.pages.length - 1].n;
      let n: ExtractNotes;
      if (c.pages.every((p) => p.text.length < 20)) n = { summary: "", topics: [], numbers: [] };
      else {
        const { system, user } = extractPrompt(kind, filename, c.pages, totalPages);
        n = await withRetry(() => llmJson({ tier: "extract", name: "chunk_notes", system, user, schema: ExtractSchema, onUsage: tr.usage }));
      }
      // keep only citations inside this chunk; an out-of-chunk citation is replaced by the chunk page(s) that
      // actually state the claim's figures (previously it was clamped to the chunk's first page → wrong cites)
      const inRange = (ps: number[]) => [...new Set(ps.map(Math.round).filter((p) => p >= lo && p <= hi))];
      const chunkNorm = c.pages.map((p) => ({ n: p.n, t: normRaw(p.text) }));
      const fallback = (claim: string) => {
        const figs = checkableFigures(claim);
        const hits = figs.length ? chunkNorm.filter((p) => figs.some((f) => p.t.includes(f))).map((p) => p.n) : [];
        return hits.length ? hits.slice(0, 3) : [lo];
      };
      for (const t of n.topics) {
        t.slug = normalizeSlug(t.slug);
        if (RESERVED.has(t.slug)) t.slug = `${t.slug}-내용`;
        for (const f of t.facts) f.pages = inRange(f.pages).length ? inRange(f.pages) : fallback(f.claim);
      }
      n.topics = n.topics.filter((t) => t.slug && t.facts.length);
      for (const x of n.numbers) x.pages = inRange(x.pages).length ? inRange(x.pages) : fallback(`${x.value} ${x.context}`);
      tr.s.chunksDone++;
      tr.event({
        msg: `청크 ${tr.s.chunksDone}/${chunks.length} 추출 완료 (${range}) · 주제 ${n.topics.length} · 사실 ${n.topics.reduce((a, t) => a + t.facts.length, 0)} · 수치 ${n.numbers.length}`,
        chunk: c.i + 1,
        chunksTotal: chunks.length,
      });
      await appendLog(docId, `## [${nowStamp()}] ingest | 청크 ${c.i + 1}/${chunks.length} 추출 (${range}) | 주제: ${n.topics.map((t) => t.slug).join(", ") || "-"}\n`);
      return n;
    });
    await writeState(docId, "notes.json", notes);

    // ---- 2) PLAN: consolidate candidate slugs into the final page structure
    tr.phase("planning", "주제 후보를 정리해 위키 페이지 구조를 계획하는 중");
    const cand = new Map<string, { slug: string; title: string; type: string; facts: number; sample: string }>();
    for (const n of notes)
      for (const t of n.topics) {
        const c = cand.get(t.slug) ?? { slug: t.slug, title: t.title, type: t.type, facts: 0, sample: t.facts[0]?.claim.slice(0, 80) ?? "" };
        c.facts += t.facts.length;
        cand.set(t.slug, c);
      }
    const maxPages = Math.round(Math.min(30, 10 + totalPages / 6));
    let plan: Plan;
    try {
      const { system, user } = planPrompt(kind, [...cand.values()], maxPages);
      plan = await withRetry(() => llmJson({ tier: "plan", name: "wiki_plan", system, user, schema: PlanSchema, onUsage: tr.usage }), 2);
    } catch {
      plan = { pages: [...cand.values()].map((c) => ({ slug: c.slug, title: c.title, type: c.type as "topic", from: [c.slug] })) };
    }
    const alias = new Map<string, string>();
    const pageMeta = new Map<string, { title: string; type: PageType }>();
    for (const p of plan.pages) {
      let slug = normalizeSlug(p.slug);
      if (!slug) continue;
      if (RESERVED.has(slug)) slug = `${slug}-내용`;
      if (!pageMeta.has(slug)) pageMeta.set(slug, { title: p.title, type: p.type });
      for (const f of [...p.from, p.slug]) alias.set(normalizeSlug(f), slug);
    }
    for (const c of cand.values())
      if (!alias.has(c.slug)) {
        alias.set(c.slug, c.slug);
        if (!pageMeta.has(c.slug)) pageMeta.set(c.slug, { title: c.title, type: c.type as PageType });
      }
    await writeState(docId, "plan.json", { pages: [...pageMeta].map(([slug, m]) => ({ slug, ...m })), alias: Object.fromEntries(alias) });
    tr.event({ msg: `후보 ${cand.size}개 → 위키 페이지 ${pageMeta.size}개로 계획` });
    await appendLog(docId, `## [${nowStamp()}] plan | 후보 ${cand.size} → 페이지 ${pageMeta.size} | ${[...pageMeta.keys()].join(", ")}\n`);

    // ---- 3) MERGE: incremental rounds in page order; within a round, one writer per touched page (parallel)
    tr.phase("merging", "라운드별로 위키 페이지를 생성·갱신하는 중");
    const rounds = Math.max(1, Math.min(5, Math.ceil(chunks.length / 3)));
    const per = Math.ceil(chunks.length / rounds);
    tr.s.roundsTotal = Math.ceil(chunks.length / per);
    const allPages = () => [...pageMeta].map(([slug, m]) => ({ slug, title: m.title })).concat([{ slug: "주요-수치", title: "주요 수치" }, { slug: "overview", title: "개요" }]);
    const created = new Set<string>();

    for (let r = 0; r < tr.s.roundsTotal; r++) {
      const rc = chunks.slice(r * per, (r + 1) * per);
      const rangeLabel = `p.${rc[0].pages[0].n}–${rc[rc.length - 1].pages[rc[rc.length - 1].pages.length - 1].n}`;
      const factsBySlug = new Map<string, Fact[]>();
      for (const c of rc)
        for (const t of notes[c.i].topics) {
          const slug = alias.get(t.slug) ?? t.slug;
          const arr = factsBySlug.get(slug) ?? [];
          arr.push(...t.facts);
          factsBySlug.set(slug, arr);
        }
      const indexMd = (await readPage(docId, "index")) ?? "";
      const results = await pool([...factsBySlug], 10, async ([slug, facts]) => {
        const m = pageMeta.get(slug) ?? { title: slug, type: "topic" as PageType };
        const existingMd = await readPage(docId, slug);
        const parsed = existingMd ? parseFrontmatter(existingMd) : null;
        const existing = parsed ? parsed.body : null;
        let op: WriteOp;
        try {
          const { system, user } = writePrompt({ kind, filename, slug, title: m.title, existing, facts, indexMd, allPages: allPages(), round: r + 1, rounds: tr.s.roundsTotal, pageRange: rangeLabel });
          op = await withRetry(() => llmJson({ tier: "write", name: "page_op", system, user, schema: WriteSchema, onUsage: tr.usage }), 2);
        } catch {
          op = { action: existing ? "append" : "create", title: m.title, summary: "", markdown: factsSection(m.title, facts, !existing) };
        }
        const applied = await applyOp(docId, slug, m, existing, op, facts, totalPages, parsed?.fm.summary);
        return { slug, applied };
      });
      const c2: string[] = [];
      const u2: string[] = [];
      for (const { slug, applied } of results) {
        if (applied === "create") {
          c2.push(slug);
          created.add(slug);
        } else if (applied !== "skip") u2.push(slug);
      }
      tr.s.pagesCreated += c2.length;
      tr.s.pagesUpdated += u2.length;
      await rebuildIndex(docId, filename, totalPages);
      tr.s.roundsDone = r + 1;
      tr.s.wikiPages = (await listPages(docId)).length;
      tr.event({ msg: `라운드 ${r + 1}/${tr.s.roundsTotal} (${rangeLabel}) · 생성 ${c2.length} · 갱신 ${u2.length}`, created: c2, updated: u2 });
      await appendLog(docId, `## [${nowStamp()}] merge | 라운드 ${r + 1}/${tr.s.roundsTotal} (${rangeLabel}) | 생성: ${c2.join(", ") || "-"} | 갱신: ${u2.join(", ") || "-"}\n`);
    }

    // ---- 4) FINALIZE: overview (strong model) ∥ key numbers (fast model)
    tr.phase("finalizing", "개요(overview)와 주요-수치 페이지 작성 중");
    const indexMd = (await readPage(docId, "index")) ?? "";
    const rawNumbers = notes.flatMap((n) => n.numbers);
    const [ov, nums] = await Promise.all([
      withRetry(() => {
        const { system, user } = overviewPrompt(kind, filename, totalPages, indexMd, notes.map((n) => n.summary).filter(Boolean));
        return llmJson({ tier: "overview", name: "overview", system, user, schema: OverviewSchema, onUsage: tr.usage });
      }, 2).catch(() => null),
      withRetry(() => {
        const { system, user } = numbersPrompt(kind, filename, rawNumbers);
        return llmJson({ tier: "numbers", name: "key_numbers", system, user, schema: NumbersSchema, onUsage: tr.usage });
      }, 2).catch(() => null),
    ]);
    const llmNumbers: KeyNumber[] = (nums?.numbers ?? rawNumbers.map((x) => ({ metric: x.metric, value: x.value, pages: x.pages, note: x.context, conflict: false }))).map((k) => ({
      ...k,
      pages: [...new Set(k.pages.map(Math.round).filter((p) => p >= 1 && p <= totalPages))].sort((a, b) => a - b),
    }));
    // deterministic check against the raw pages: drop citations that don't state the value, flag missed conflicts
    const { rows: keyNumbers, stats: vs } = verifyKeyNumbers(llmNumbers, texts);
    await writeState(docId, "keynumbers.json", keyNumbers);
    tr.event({ msg: `주요 수치 원문 대조: ${vs.rowsChecked}행 확인 · 근거 없는 인용 ${vs.droppedCitations}개 제거 · 새 충돌 ${vs.newConflicts}건` });
    const stamp = new Date().toISOString();
    await writePage(docId, "주요-수치", renderNumbersPage(keyNumbers, filename, stamp));
    const overviewBody = ov?.markdown ? stripFm(ov.markdown) : `# 개요\n\n> ${filename} (${totalPages}쪽)\n\n${notes.map((n) => `- ${n.summary}`).join("\n")}\n`;
    await writePage(
      docId,
      "overview",
      buildFrontmatter({ title: "개요", type: "overview", summary: overviewSummary(ov?.summary, overviewBody, filename), sources: extractCitations(overviewBody), updated: stamp }) + overviewBody,
    );
    // deterministic citation grounding for every topic page (주요-수치 is verified separately above)
    const rg = await regroundPages(docId, texts);
    tr.event({ msg: `본문 수치 인용 원문 대조: ${rg.groups}개 인용 확인 · ${rg.fixed}개에 실제 출처 쪽 추가` });
    await rebuildIndex(docId, filename, totalPages);
    const pages = await listPages(docId);
    tr.s.wikiPages = pages.length;
    tr.s.pagesCreated += 2;
    await appendLog(
      docId,
      `## [${nowStamp()}] finalize | overview, 주요-수치(${keyNumbers.length}행, 충돌 ${keyNumbers.filter((k) => k.conflict).length}) | 총 페이지 ${pages.length}\n`,
    );
    tr.s.timings.total = Date.now() - t0;
    tr.s.finishedAt = new Date().toISOString();
    const tokens = Object.values(tr.s.usage).reduce((a, u) => [a[0] + u.inputTokens, a[1] + u.outputTokens], [0, 0]);
    await appendLog(docId, `## [${nowStamp()}] ingest | 완료 | ${(tr.s.timings.total / 1000).toFixed(1)}초 · 입력 ${tokens[0].toLocaleString()} / 출력 ${tokens[1].toLocaleString()} 토큰 · ${tr.s.provider}\n`);
    return { texts, meta };
  }
}

function overviewSummary(s: string | undefined, body: string, filename: string): string {
  if (s && s.length >= 12 && !/개요 작성|요약 작성/.test(s)) return s;
  const q = body.match(/^>\s*(?:한 줄 요약:\s*)?(.+)$/m)?.[1];
  return q ? (q.length > 70 ? q.slice(0, 68) + "…" : q) : `${filename} 전체 요약`;
}

const stripFm = (md: string) => parseFrontmatter(md.trim()).body.trim() + "\n";

function factsSection(title: string, facts: Fact[], withTitle: boolean): string {
  const bullets = facts.map((f) => `- ${f.claim} (p.${f.pages.join(", p.")})`).join("\n");
  return withTitle ? `# ${title}\n\n> ${facts[0]?.claim ?? ""}\n\n## 내용\n${bullets}\n` : `## 추가 내용\n${bullets}\n`;
}

/** Apply a writer op with a data-loss guard. Returns the effective action. */
async function applyOp(
  docId: string,
  slug: string,
  m: { title: string; type: PageType },
  existing: string | null,
  op: WriteOp,
  facts: Fact[],
  pageCount: number,
  prevSummary?: string,
): Promise<"create" | "update" | "append" | "skip"> {
  let body: string;
  let action = op.action;
  const md = stripFm(op.markdown || "");
  if (!existing && action !== "create") action = "create";
  if (action === "skip") {
    if (!existing) return "skip";
    // still verify the new facts' pages are cited somewhere; otherwise append them
    const cited = new Set(extractCitations(existing));
    const missing = facts.filter((f) => !f.pages.some((p) => cited.has(p)));
    if (!missing.length) return "skip";
    body = existing.trimEnd() + "\n\n" + factsSection(m.title, missing, false);
    action = "append";
  } else if (action === "append") {
    body = existing!.trimEnd() + "\n\n" + md;
  } else if (action === "update" && existing) {
    // guard: an update must not drop a large part of what was already cited
    const before = new Set(extractCitations(existing));
    const after = new Set(extractCitations(md));
    const lost = [...before].filter((p) => !after.has(p));
    if (before.size >= 3 && lost.length / before.size > 0.3) {
      body = existing.trimEnd() + "\n\n" + factsSection(m.title, facts, false);
      action = "append";
    } else body = md;
  } else body = md;

  if (!body.trim()) return "skip";
  if (!/^#\s/m.test(body)) body = `# ${op.title || m.title}\n\n${body}`;
  const sources = extractCitations(body).filter((p) => p <= pageCount);
  await writePage(
    docId,
    slug,
    // index.md is a catalog of what each page IS — keep the page summary when the writer described its edit instead
    buildFrontmatter({ title: op.title || m.title, type: m.type, summary: pageSummary(op.summary, prevSummary, body), sources, updated: new Date().toISOString() }) + body,
  );
  return action;
}

function renderNumbersPage(rows: KeyNumber[], filename: string, stamp: string): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const conflicts = rows.filter((r) => r.conflict);
  const body = `# 주요 수치

> ${filename}에 나오는 핵심 수치 ${rows.length}개${conflicts.length ? ` · 문서 안 값 충돌 ${conflicts.length}건` : ""}. 심사·리포트에서 일관성 검사에 쓴다.

| 항목 | 값 | 출처 | 비고 |
|---|---|---|---|
${rows.map((r) => `| ${esc(r.metric)} | ${r.conflict ? "⚠ " : ""}${esc(r.value)} | ${r.pages.length ? `(p.${compactPages(r.pages).replace(/, /g, ", p.")})` : "-"} | ${esc(r.note)} |`).join("\n")}
${conflicts.length ? `\n## 문서 안 충돌\n${conflicts.map((r) => `- **[불일치]** ${r.metric}: ${r.value} (p.${r.pages.join(", p.")}) — ${r.note}`).join("\n")}\n` : ""}
관련: [[overview]] · [[index]]
`;
  return buildFrontmatter({ title: "주요 수치", type: "numbers", summary: `핵심 수치 ${rows.length}개 표(출처 포함)`, sources: extractCitations(body), updated: stamp }) + body;
}

/** Re-run the deterministic raw-text check on an existing wiki's key numbers (no LLM call). */
export async function reverifyKeyNumbers(docId: string) {
  const [meta, st] = await Promise.all([readMeta(docId), readStatusFile(docId)]);
  if (!meta || !st) throw new Error(`unknown docId ${docId}`);
  if (st.state !== "ready") throw new Error(`wiki not ready (${st.state})`);
  if (jobs.has(docId)) throw new Error("위키를 다시 만드는 중이라 지금은 실행할 수 없습니다. 끝난 뒤 다시 시도하세요");
  const [rows, raw] = await Promise.all([readKeyNumbers(docId), readAllRawPages(docId, meta.pageCount)]);
  const { rows: out, stats } = verifyKeyNumbers(rows, raw);
  await writeState(docId, "keynumbers.json", out);
  await writePage(docId, "주요-수치", renderNumbersPage(out, meta.filename, new Date().toISOString()));
  await rebuildIndex(docId, meta.filename, meta.pageCount);
  await appendLog(docId, `## [${nowStamp()}] lint | 주요-수치 원문 대조 | ${stats.rowsChecked}행 · 근거 없는 인용 ${stats.droppedCitations}개 제거 · 새 충돌 ${stats.newConflicts}건\n`);
  return { docId, ...stats, conflicts: out.filter((r) => r.conflict).length };
}

/** Re-ground figure citations on all content pages (not 주요-수치/meta) against the raw pages; fix delta summaries. */
async function regroundPages(docId: string, raw: string[]) {
  const tot = { groups: 0, fixed: 0, added: 0, summaries: 0, pages: 0 };
  for (const p of await listPages(docId)) {
    if (p.type === "numbers" || p.type === "meta") continue;
    const md = await readPage(docId, p.slug);
    if (!md) continue;
    const { fm, body } = parseFrontmatter(md);
    const r = regroundCitations(body, raw);
    const summary = pageSummary(fm.summary, undefined, r.body);
    tot.groups += r.stats.groups;
    tot.fixed += r.stats.fixed;
    tot.added += r.stats.added;
    if (!r.stats.fixed && summary === (fm.summary ?? "")) continue;
    if (summary !== (fm.summary ?? "")) tot.summaries++;
    tot.pages++;
    const sources = extractCitations(r.body).filter((n) => n <= raw.length);
    await writePage(docId, p.slug, buildFrontmatter({ ...fm, summary, sources }) + r.body);
  }
  return tot;
}

/** Deterministic maintenance of an existing wiki (no LLM): re-ground figure citations in the raw text, restore
 *  page summaries that were edit notes, re-verify 주요-수치, rebuild index.md. Safe to run repeatedly. */
export async function repairWiki(docId: string) {
  const [meta, st] = await Promise.all([readMeta(docId), readStatusFile(docId)]);
  if (!meta || !st) throw new Error(`unknown docId ${docId}`);
  if (st.state !== "ready") throw new Error(`wiki not ready (${st.state})`);
  if (jobs.has(docId)) throw new Error("위키를 다시 만드는 중이라 지금은 실행할 수 없습니다. 끝난 뒤 다시 시도하세요");
  const raw = await readAllRawPages(docId, meta.pageCount);
  const rg = await regroundPages(docId, raw);
  const kn = await reverifyKeyNumbers(docId); // also rebuilds index.md
  await appendLog(
    docId,
    `## [${nowStamp()}] lint | repair(결정적) | 수치 인용 ${rg.groups}개 확인 · ${rg.fixed}개 보정(+${rg.added}쪽) · 요약 ${rg.summaries}개 복원 · 주요-수치 근거 없는 인용 ${kn.droppedCitations}개 제거\n`,
  );
  return { docId, citationGroups: rg.groups, citationsFixed: rg.fixed, pagesAdded: rg.added, summariesFixed: rg.summaries, pagesTouched: rg.pages, keyNumbers: kn };
}

/** index.md is rebuilt deterministically from page frontmatter (LLM-written summaries). */
export async function rebuildIndex(docId: string, filename: string, pageCount: number) {
  const pages = await listPages(docId);
  const range = (s: number[]) => {
    if (!s.length) return "";
    const parts = compactPages(s).split(", ");
    return ` (p.${parts.slice(0, 4).join(", p.")}${parts.length > 4 ? ` 외 ${parts.length - 4}곳` : ""})`;
  };
  const line = (p: (typeof pages)[number]) => `- [[${p.slug}${p.title && p.title !== p.slug ? `|${p.title}` : ""}]] — ${p.summary || "요약 없음"}${range(p.sources)}`;
  const groups: [string, (p: (typeof pages)[number]) => boolean][] = [
    ["개요·수치", (p) => p.type === "overview" || p.type === "numbers"],
    ["주제", (p) => p.type === "topic" || p.type === "concept"],
    ["대상(제품·조직·파트너)", (p) => p.type === "entity"],
    ["분석(질의 결과 보관)", (p) => p.type === "analysis"],
  ];
  const sections = groups
    .map(([h, f]) => {
      const ps = pages.filter(f);
      return ps.length ? `## ${h}\n${ps.map(line).join("\n")}\n` : "";
    })
    .filter(Boolean)
    .join("\n");
  const md = `${buildFrontmatter({ title: "인덱스", type: "meta", updated: new Date().toISOString() })}# index — ${filename}

> 이 위키의 모든 페이지 카탈로그 · 페이지 ${pages.length}개 · 원문 ${pageCount}쪽. 질의 시 먼저 이 파일을 읽고 필요한 페이지를 고른다.

${sections}
## 메타
- [[log]] — 작업 기록(추가 전용)
- [[SCHEMA]] — 위키 규칙
`;
  await writePage(docId, "index", md);
}
