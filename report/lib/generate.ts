import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionRecord, Temperament } from "@/lib/types";
import { listWikiPages } from "@/wiki/lib";
import {
  cachedLint,
  figures,
  groundRef,
  loadDocsById,
  normRaw,
  findPages,
  isSmall,
  keyNumbersText,
  lintText,
  rawText,
  REPORT_DIR,
  resolveDocs,
  topicContext,
  wikiPage,
  type DocCtx,
  type Docs,
} from "./context";
import { koError, llmJson as llmJsonAny, LlmUnavailableError, newUsage, providerLabel, type JsonCall, type Provider, type Usage } from "./llm";
import type { z } from "zod";
import { computeSpeechMetrics, countFillers } from "./metrics";
import { ConsistencySchema, consistencyPrompt, DocSchema, docPrompt, OverallSchema, overallPrompt, QASchema, qaPrompt, SpeechSchema, speechPrompt } from "./prompts";
import {
  DOC_LABEL,
  REPORT_VERSION,
  SUBSCORE_LABEL,
  type ConsistencyRow,
  type Contradiction,
  type DocEvaluation,
  type DocRef,
  type DocRole,
  type Overall,
  type ProgressEvent,
  type QAEvaluation,
  type Report,
  type SpeechAnalysis,
  type SpeechMetrics,
  type StepInfo,
  type SubScores,
} from "./types";

export const REPORTS_DIR = path.join(REPORT_DIR, "reports");
const WEIGHTS: Record<keyof SubScores, number> = { delivery: 0.25, logic: 0.25, response: 0.3, materials: 0.2 };

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(x) ? x : 0)));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function reportKey(session: SessionRecord): string {
  return createHash("sha256").update(JSON.stringify({ v: REPORT_VERSION, session })).digest("hex").slice(0, 16);
}

/** A cached report is valid only when it was written complete. Legacy (pre-fix) files are accepted only if they show
 *  no failed section (no "… 실패:" warning and at least one LLM call). */
export function isCompleteReport(r: Report): boolean {
  if (r.meta.complete === false) return false;
  if (r.meta.complete === true) return true;
  return r.meta.usage.calls > 0 && !r.meta.warnings.some((w) => / 실패: /.test(w));
}

export async function readCachedReport(key: string): Promise<Report | null> {
  if (!/^[0-9a-f]{16}$/.test(key)) return null;
  const file = path.join(REPORTS_DIR, `${key}.json`);
  try {
    const r = JSON.parse(await readFile(file, "utf8")) as Report;
    if (!isCompleteReport(r)) return null;
    if (r.meta.numberPolicy !== NUMBER_POLICY) {
      await migrateNumberPolicy(r);
      await writeFile(`${file}.tmp`, JSON.stringify(r, null, 1));
      await rename(`${file}.tmp`, file);
    }
    return dedupeReportRefs(r);
  } catch {
    return null;
  }
}

// ───────────────────────── presenter-fault policy for speech number issues ─────────────────────────

const NUMBER_POLICY = 1;

/** Figures the presenter asserted in a claim (sentence markers "[22]~[23]" and bare years removed — years are context). */
function claimFigures(claim: string): string[] {
  return figures(claim.replace(/\[\d+\](?:\s*[~–-]\s*\[\d+\])?/g, " ")).filter((f) => !/^(19|20)\d{2}(년)?$/.test(f));
}

/**
 * Deterministic policy (code, not LLM): a figure the presenter said is a presenter error only if NO document backs it.
 * If every figure in the claim is printed on the pages this issue cites for one document, the presenter quoted that
 * document faithfully and the documents disagree with each other → matchesDoc=<doc>, severity "low" (no logic penalty).
 * The deck↔proposal mismatch itself is scored in 자료 품질 (consistency table + doc evaluations), so it is not
 * double-counted against the speaker. Only the cited (re-grounded) pages are searched, so a wrong number that happens
 * to appear somewhere else in a 57-page proposal is not excused.
 */
export function applyNumberPolicy(docs: Pick<Docs, "presentation" | "proposal">, issues: Contradiction[]): Contradiction[] {
  return issues.map((c) => {
    const figs = claimFigures(c.claim);
    const base = { ...c };
    delete base.matchesDoc;
    if (!figs.length) return base;
    for (const role of ["presentation", "proposal"] as DocRole[]) {
      const doc = docs[role];
      const pages = [...new Set(c.refs.filter((r) => r.doc === role).flatMap((r) => r.pages))];
      if (!doc || !pages.length) continue;
      const text = pages.map((p) => normRaw(doc.raw[p - 1] ?? "")).join("\n");
      if (figs.every((f) => text.includes(f))) return { ...base, matchesDoc: role, severity: "low" as const };
    }
    return base;
  });
}

/** Re-apply the policy to an older cached report and recompute sub-scores/total with the same code as generation. */
async function migrateNumberPolicy(r: Report): Promise<void> {
  const a = r.speech.analysis;
  if (a?.numberIssues.length) {
    const docs = await loadDocsById(r.meta.docIds);
    a.numberIssues = applyNumberPolicy(docs, a.numberIssues);
    const sub = subScores(r.speech.metrics, a, r.qa, r.materials.docs);
    const before = r.overall.total;
    r.overall.sub = sub;
    r.overall.total = weightedTotal(sub);
    if (r.overall.total !== before) r.meta.warnings = [...r.meta.warnings, `수치 감점 정책 갱신(자료 중 한쪽과 일치하는 수치는 감점 없음)으로 총점 ${before}→${r.overall.total} 재계산`];
  }
  r.meta.numberPolicy = NUMBER_POLICY;
}

/** Raised when at least one evaluated section failed. Nothing is cached; finished sections are kept in memory and
 *  reused by the next attempt for the same session content. */
export class ReportIncompleteError extends Error {
  constructor(
    message: string,
    readonly failedSteps: string[],
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ReportIncompleteError";
  }
}

export interface GenerateOptions {
  force?: boolean;
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
  /** judge with one provider only (claude | openai | gemini); default = Claude → OpenAI → Gemini fallback chain.
   *  Not part of the cache key: the cache holds the latest complete report for the session content. */
  provider?: Provider;
}

// ───────────────────────── in-flight registry (dedupe concurrent requests, survives HMR) ─────────────────────────

interface Job {
  steps: Map<string, StepInfo>;
  listeners: Set<(e: ProgressEvent) => void>;
  promise: Promise<Report>;
}
interface PartialRun {
  at: number;
  steps: Map<string, { result: unknown; usage: Usage; detail?: string; ms?: number }>;
}
const PARTIAL_TTL_MS = 2 * 60 * 60_000;
const g = globalThis as unknown as { __reportJobs?: Map<string, Job>; __reportPartials?: Map<string, PartialRun> };
const jobs = (g.__reportJobs ??= new Map());
const partials = (g.__reportPartials ??= new Map());

/** Generate (or load from cache) the report for a session. Progress events are emitted per section step.
 *  Throws ReportIncompleteError (and writes nothing) if any evaluated section fails. */
export async function generateReport(session: SessionRecord, opts: GenerateOptions = {}): Promise<Report> {
  const key = reportKey(session);
  if (!opts.force) {
    const cached = await readCachedReport(key);
    if (cached) {
      opts.onProgress?.({ type: "cached", key });
      return cached;
    }
  }
  const existing = jobs.get(key);
  if (existing) {
    if (opts.onProgress) {
      opts.onProgress({ type: "steps", steps: [...existing.steps.values()] });
      existing.listeners.add(opts.onProgress);
    }
    try {
      return await existing.promise;
    } finally {
      if (opts.onProgress) existing.listeners.delete(opts.onProgress);
    }
  }
  const job: Job = { steps: new Map(), listeners: new Set(opts.onProgress ? [opts.onProgress] : []), promise: Promise.resolve(null as unknown as Report) };
  job.promise = providerCtx.run(opts.provider, () => run(session, key, job)).finally(() => jobs.delete(key));
  jobs.set(key, job);
  return job.promise;
}

// the provider restriction travels with the async context of one run (steps call llmJson deep inside runners)
const providerCtx = new AsyncLocalStorage<Provider | undefined>();
function llmJson<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>> {
  return llmJsonAny({ ...call, only: call.only ?? providerCtx.getStore() });
}

const LLM_STEP = (id: string) => id === "speech" || id === "consistency" || id === "overall" || id.startsWith("qa:") || id.startsWith("doc:");

async function run(session: SessionRecord, key: string, job: Job): Promise<Report> {
  const t0 = Date.now();
  const usage = newUsage();
  const timings: Record<string, number> = {};
  const emit = (e: ProgressEvent) => job.listeners.forEach((l) => l(e));
  for (const [k, p] of partials) if (Date.now() - p.at > PARTIAL_TTL_MS) partials.delete(k);
  const memo: PartialRun = partials.get(key) ?? { at: Date.now(), steps: new Map() };
  const reused: string[] = [];

  const presentQ = session.qa.map((q, i) => ({ q, i }));
  const initial: StepInfo[] = [
    { id: "metrics", group: "speech", label: "발표 지표 계산 (말 속도·군말·침묵·시간)", status: "pending" },
    { id: "docs", group: "prep", label: "자료 위키 준비", status: "pending" },
    { id: "lint", group: "materials", label: "위키 점검 (문서 내·문서 간 수치)", status: "pending" },
    { id: "speech", group: "speech", label: "발표 내용 분석 · 슬라이드 커버리지", status: "pending" },
    ...presentQ.map(({ q, i }) => ({ id: `qa:${i}`, group: "qa" as const, label: `질문 ${i + 1} · ${q.judge.name}`, status: "pending" as const })),
    { id: "doc:presentation", group: "materials", label: "발표자료 품질", status: "pending" },
    { id: "doc:proposal", group: "materials", label: "제안자료 품질", status: "pending" },
    { id: "consistency", group: "materials", label: "덱 ↔ 제안서 수치 대조", status: "pending" },
    { id: "overall", group: "overall", label: "종합 점수 · 코멘트", status: "pending" },
  ];
  initial.forEach((s) => job.steps.set(s.id, s));
  emit({ type: "steps", steps: initial });

  const errors = new Map<string, unknown>();
  const step = async <T>(id: string, fn: (u: Usage) => Promise<T>, detail?: (r: T) => string): Promise<T> => {
    const s = job.steps.get(id)!;
    const prev = memo.steps.get(id);
    if (prev && LLM_STEP(id)) {
      // reuse a section that already succeeded in an earlier (failed) attempt for this exact session content
      mergeUsage(usage, prev.usage);
      reused.push(id);
      Object.assign(s, { status: "done", ms: prev.ms, detail: `${prev.detail ?? "완료"} · 이전 시도 결과 재사용` });
      emit({ type: "step", step: { ...s } });
      return prev.result as T;
    }
    const st = Date.now();
    Object.assign(s, { status: "running" });
    emit({ type: "step", step: { ...s } });
    const u = newUsage();
    try {
      const r = await fn(u);
      const d = detail?.(r);
      Object.assign(s, { status: "done", ms: Date.now() - st, detail: d });
      timings[id] = Date.now() - st;
      mergeUsage(usage, u);
      if (LLM_STEP(id)) memo.steps.set(id, { result: r, usage: u, detail: d, ms: Date.now() - st });
      emit({ type: "step", step: { ...s } });
      return r;
    } catch (e) {
      errors.set(id, e);
      console.error(`[report] step ${id} failed:`, e instanceof Error ? e.message.slice(0, 300) : e);
      Object.assign(s, { status: "error", ms: Date.now() - st, detail: koError(e, true) });
      timings[id] = Date.now() - st;
      emit({ type: "step", step: { ...s } });
      throw e;
    }
  };
  const skip = (id: string, detail: string) => {
    const s = job.steps.get(id);
    if (!s) return;
    Object.assign(s, { status: "skipped", detail });
    emit({ type: "step", step: { ...s } });
  };
  // errors are recorded in `errors` by step(); the section is then treated as failed for the whole report
  const soft = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

  try {
    // 1. deterministic metrics
    const metrics = await step("metrics", async () => computeSpeechMetrics(session.transcript, { presentationMinutes: session.presentationMinutes }), (m) => `${m.syllablesPerMinute}음절/분 · 군말 ${m.fillers.total}회 · 전달 ${m.deliveryScore}점`);
    if (metrics.sentenceCount === 0 && session.qa.length === 0) throw new ReportIncompleteError("평가할 발표 전사와 질의응답이 모두 비어 있어요. 발표를 진행한 세션을 골라 주세요.", [], false);

    // 2. documents (wiki)
    const docs = await step("docs", () => resolveDocs(session), (d) => [d.presentation && `덱 ${d.presentation.meta.pageCount}쪽`, d.proposal && `제안서 ${d.proposal.meta.pageCount}쪽`].filter(Boolean).join(" · "));
    const pres = docs.presentation;
    const prop = docs.proposal;

    const lintP = step(
      "lint",
      async () => {
        const [cross, selfPres, selfProp] = await Promise.all([
          prop && pres ? cachedLint(prop.docId, pres.docId) : null,
          pres ? cachedLint(pres.docId) : null,
          prop ? cachedLint(prop.docId) : null,
        ]);
        return { cross, selfPres, selfProp };
      },
      (l) => `문서 간 불일치 ${l.cross?.issues.filter((i) => i.type === "cross-doc-mismatch").length ?? 0}건`,
    );
    const crossText = lintP.then((l) => lintText(l.cross, "제안자료", "발표자료"));

    // 3a. speech content (needs a presentation transcript and at least one document)
    const speechP =
      metrics.sentenceCount === 0
        ? (skip("speech", "발표 전사 없음"), Promise.resolve(null))
        : pres || prop
          ? soft(step("speech", (u) => runSpeech(session, docs, u), (s) => `구조 ${s.scores.structure} · 커버리지 ${Math.round(s.coverageRate * 100)}%`))
          : (skip("speech", "자료 없음"), Promise.resolve(null));

    // 3b. Q&A (parallel, cap 6)
    const qaP = poolMap(presentQ, 6, ({ i }) =>
      soft(
        step(
          `qa:${i}`,
          async (u) => runQA(session, i, docs, await crossText, u),
          (r) => `${r.score}점 · ${VERDICT_KO[r.verdict]}${r.contradictions.length ? ` · 모순 ${r.contradictions.length}` : ""}`,
        ),
      ),
    );

    // 3c. documents + consistency (after lint)
    const docRoles: DocRole[] = ["presentation", "proposal"];
    const docPs = docRoles.map((role) => {
      const d = docs[role];
      if (!d) {
        skip(`doc:${role}`, "자료 없음");
        return Promise.resolve(null);
      }
      const other = docs[role === "presentation" ? "proposal" : "presentation"];
      return soft(
        step(
          `doc:${role}`,
          async (u) => {
            const l = await lintP;
            return runDoc(session, d, other, l.cross, role === "presentation" ? l.selfPres : l.selfProp, docs, u);
          },
          (r) => `${r.score}점 · 이슈 ${r.issues.length}건`,
        ),
      );
    });
    const consP =
      pres && prop
        ? soft(step("consistency", async (u) => runConsistency(pres, prop, await crossText, u), (rows) => `불일치 ${rows.filter((r) => r.status === "mismatch").length}건 / ${rows.length}개 지표`))
        : (skip("consistency", "자료 1개"), Promise.resolve(null));

    const [speech, qaRes, docRes, consistency] = await Promise.all([speechP, qaP, Promise.all(docPs), consP]);
    partials.set(key, memo); // keep finished sections for a retry, whatever happens next
    failIfErrors(errors, job, skip);

    const qa = qaRes.filter((x): x is QAEvaluation => !!x);
    const docEvals = docRes.filter((x): x is DocEvaluation => !!x);
    const warnings = [...docs.warnings];

    // 4. scores (deterministic aggregation) + overall copy (LLM)
    const materialsScore = docEvals.length ? clamp(mean(docEvals.map((d) => d.score))) : null;
    const sub = subScores(metrics, speech, qa, docEvals);
    const total = weightedTotal(sub);
    const overallCopy = await soft(step("overall", (u) => runOverall(session, metrics, speech, qa, docEvals, consistency ?? [], sub, total, u)));
    failIfErrors(errors, job, skip);
    const overall: Overall = {
      total,
      sub,
      weights: WEIGHTS,
      excluded: excludedSubScores(sub, metrics, session, docEvals.length > 0),
      headline: overallCopy!.headline,
      oneLiner: overallCopy!.oneLiner,
      strengths: overallCopy!.strengths.slice(0, 3),
      priorities: overallCopy!.priorities.slice(0, 3),
    };

    const report: Report = {
      meta: {
        key,
        version: REPORT_VERSION,
        sessionId: session.id,
        situation: session.situation,
        presentationMinutes: session.presentationMinutes,
        qaMinutes: session.qaMinutes,
        judges: session.judges.length,
        questions: session.qa.length,
        docIds: { presentation: pres?.docId, proposal: prop?.docId },
        provider: providerLabel(usage),
        createdAt: new Date().toISOString(),
        ms: Date.now() - t0,
        timings,
        usage,
        warnings,
        complete: true,
        numberPolicy: NUMBER_POLICY,
        reusedSteps: reused.length ? reused : undefined,
      },
      speech: { metrics, analysis: speech },
      qa,
      materials: { docs: docEvals, consistency: consistency ?? [], score: materialsScore },
      overall,
    };
    // only complete reports reach this point → a failed "다시 생성" can never overwrite a good cached report
    await mkdir(REPORTS_DIR, { recursive: true });
    const file = path.join(REPORTS_DIR, `${key}.json`);
    await writeFile(`${file}.tmp`, JSON.stringify(report, null, 1));
    await rename(`${file}.tmp`, file);
    partials.delete(key);
    emit({ type: "done", report });
    return report;
  } catch (e) {
    const err = e instanceof ReportIncompleteError ? e : new ReportIncompleteError(`리포트를 만들지 못했어요 — ${koError(e)}`, [], true);
    emit({ type: "error", error: err.message, failedSteps: err.failedSteps, retryable: err.retryable });
    throw err;
  }
}

function mergeUsage(into: Usage, u: Usage) {
  into.calls += u.calls;
  into.inputTokens += u.inputTokens;
  into.outputTokens += u.outputTokens;
  for (const [k, n] of Object.entries(u.byModel)) into.byModel[k] = (into.byModel[k] ?? 0) + n;
}

function failIfErrors(errors: Map<string, unknown>, job: Job, skip: (id: string, d: string) => void) {
  if (!errors.size) return;
  [...job.steps.values()].filter((s) => s.status === "pending").forEach((s) => skip(s.id, "앞 단계 실패로 건너뜀"));
  const ids = [...errors.keys()];
  const labels = ids.map((id) => job.steps.get(id)?.label ?? id);
  const llm = [...errors.values()].find((e): e is LlmUnavailableError => e instanceof LlmUnavailableError);
  const reason = llm ? llm.message : koError(errors.values().next().value);
  const done = [...job.steps.values()].filter((s) => LLM_STEP(s.id) && s.status === "done").length;
  throw new ReportIncompleteError(
    `리포트를 완성하지 못했어요 (${ids.length}개 섹션 실패: ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? " 외" : ""}). ${reason}${done ? ` 완료된 ${done}개 섹션은 다시 시도할 때 재사용해요.` : ""} 저장된 이전 리포트는 그대로 유지돼요.`,
    ids,
    !(llm?.final ?? false),
  );
}

function excludedSubScores(sub: SubScores, m: SpeechMetrics, session: SessionRecord, hasDocs: boolean): Overall["excluded"] {
  const out: NonNullable<Overall["excluded"]> = [];
  if (sub.delivery == null) out.push({ key: "delivery", reason: m.sentenceCount === 0 ? "발표 단계 전사가 없어요" : "발표 분석 불가" });
  if (sub.logic == null) out.push({ key: "logic", reason: "발표 전사와 자료가 없어요" });
  if (sub.response == null) out.push({ key: "response", reason: session.qa.length === 0 ? "질의응답이 없어요" : "질의응답 평가 불가" });
  if (sub.materials == null) out.push({ key: "materials", reason: hasDocs ? "자료 평가 불가" : "평가할 자료가 없어요" });
  return out;
}

const VERDICT_KO = { strong: "충실", adequate: "보통", weak: "미흡", evasive: "회피" } as const;

// ───────────────────────── scores ─────────────────────────

export function subScores(metrics: SpeechMetrics, speech: SpeechAnalysis | null, qa: QAEvaluation[], docs: DocEvaluation[]): SubScores {
  const hasTalk = metrics.sentenceCount > 0;
  const delivery = !hasTalk ? null : speech ? clamp(0.5 * metrics.deliveryScore + 0.25 * speech.scores.clarity + 0.25 * speech.scores.persuasiveness) : metrics.deliveryScore;
  const docLogic = docs.length ? mean(docs.map((d) => d.scores.logic)) : NaN;
  let logic: number | null = null;
  if (speech) {
    const base = Number.isFinite(docLogic) ? 0.6 * speech.scores.structure + 0.4 * docLogic : speech.scores.structure;
    const pen = Math.min(15, speech.numberIssues.reduce((a, c) => a + (c.severity === "high" ? 5 : c.severity === "medium" ? 2 : 0), 0));
    logic = clamp(base - pen);
  } else if (Number.isFinite(docLogic)) logic = clamp(docLogic);
  const response = qa.length ? clamp(mean(qa.map((q) => q.score))) : null;
  const materials = docs.length ? clamp(mean(docs.map((d) => d.score))) : null;
  return { delivery, logic, response, materials };
}

export function weightedTotal(sub: SubScores): number {
  let w = 0;
  let s = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof SubScores)[]) {
    const v = sub[k];
    if (v == null) continue;
    w += WEIGHTS[k];
    s += WEIGHTS[k] * v;
  }
  return w ? clamp(s / w) : 0;
}

// ───────────────────────── section runners ─────────────────────────

const transcriptText = (session: SessionRecord) =>
  session.transcript
    .filter((s) => s.phase === "presentation")
    .sort((a, b) => a.t - b.t)
    .map((s, i) => `[${i}] (${s.t.toFixed(1)}s) ${s.text}`)
    .join("\n");

/** Drop (doc, page) pairs already cited by an earlier ref so the UI never shows the same "발표자료 p.6" chip twice.
 *  Grounded refs win over ungrounded ones for the same page. Pure — also applied to legacy cached reports on read. */
export function dedupeRefs(refs: DocRef[]): DocRef[] {
  const order = [...refs.keys()].sort((a, b) => Number(refs[b].grounded === true) - Number(refs[a].grounded === true) || a - b);
  const seen = new Set<string>();
  const keep = new Map<number, DocRef>();
  for (const i of order) {
    const r = refs[i];
    const pages = r.pages.filter((p) => !seen.has(`${r.doc}:${p}`));
    pages.forEach((p) => seen.add(`${r.doc}:${p}`));
    if (pages.length || (!r.pages.length && !keep.size)) keep.set(i, { ...r, pages });
  }
  return [...keep.keys()].sort((a, b) => a - b).map((i) => keep.get(i)!);
}

/** Ground every ref against the raw PDF text, then de-duplicate pages. */
export function groundRefs(docs: Docs, refs: DocRef[]): DocRef[] {
  return dedupeRefs(refs.map((r) => groundRef(docs, r)));
}

function dedupeReportRefs(r: Report): Report {
  r.materials.docs.forEach((d) => d.issues.forEach((i) => (i.refs = dedupeRefs(i.refs))));
  r.qa.forEach((q) => {
    q.citations = dedupeRefs(q.citations);
    q.contradictions.forEach((c) => (c.refs = dedupeRefs(c.refs)));
  });
  r.speech.analysis?.numberIssues.forEach((c) => (c.refs = dedupeRefs(c.refs)));
  return r;
}

function groundContradictions(docs: Docs, cs: Contradiction[]): Contradiction[] {
  return cs.map((c) => ({ ...c, refs: groundRefs(docs, c.refs as DocRef[]) }));
}

async function runSpeech(session: SessionRecord, docs: Docs, usage: Usage): Promise<SpeechAnalysis> {
  const pres = docs.presentation;
  const transcript = transcriptText(session);
  if (!transcript) throw new Error("발표 전사가 없습니다");
  const p = speechPrompt({
    situation: session.situation,
    minutes: session.presentationMinutes,
    transcript,
    deck: pres ? rawText(pres) : "(발표자료 없음)",
    deckNumbers: pres ? keyNumbersText(pres) : "",
    proposalNumbers: docs.proposal ? keyNumbersText(docs.proposal, 60) : "(제안자료 없음)",
  });
  const r = await llmJson({ name: "speech_analysis", ...p, schema: SpeechSchema, effort: "high", usage });
  const pageCount = pres?.meta.pageCount ?? 0;
  const byPage = new Map(r.coverage.filter((c) => c.page >= 1 && c.page <= pageCount).map((c) => [Math.round(c.page), c]));
  const n = session.transcript.filter((s) => s.phase === "presentation").length;
  const coverage = Array.from({ length: pageCount }, (_, i) => {
    const c = byPage.get(i + 1);
    return c
      ? { ...c, page: i + 1, sentences: c.sentences.map(Math.round).filter((x) => x >= 0 && x < n) }
      : { page: i + 1, title: `${i + 1}쪽`, status: "missing" as const, sentences: [], note: "평가에서 언급 확인 안 됨" };
  });
  const coverageRate = coverage.length ? coverage.reduce((a, c) => a + (c.status === "covered" ? 1 : c.status === "partial" ? 0.5 : 0), 0) / coverage.length : 0;
  return {
    scores: { structure: clamp(r.scores.structure), clarity: clamp(r.scores.clarity), persuasiveness: clamp(r.scores.persuasiveness) },
    summary: r.summary,
    structureNote: r.structureNote,
    clarityNote: r.clarityNote,
    persuasivenessNote: r.persuasivenessNote,
    strengths: r.strengths,
    improvements: r.improvements,
    coverage,
    coverageRate: Math.round(coverageRate * 1000) / 1000,
    numberIssues: applyNumberPolicy(docs, groundContradictions(docs, r.numberIssues)),
  };
}

/** Transcript sentences that share the most Hangul bigrams/figures with the question (lexical, no LLM). */
function talkExcerpt(session: SessionRecord, question: string, max = 4): string {
  const grams = (s: string) => {
    const t = s.replace(/[^가-힣0-9]/g, "");
    const out = new Set<string>();
    for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  const q = grams(question);
  return session.transcript
    .filter((s) => s.phase === "presentation")
    .map((s, i) => ({ s, i, c: [...grams(s.text)].filter((x) => q.has(x)).length }))
    .filter((x) => x.c >= 3)
    .sort((a, b) => b.c - a.c)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => `[${x.i}] ${x.s.text}`)
    .join("\n");
}

async function runQA(session: SessionRecord, i: number, docs: Docs, crossLint: string, usage: Usage): Promise<QAEvaluation> {
  const item = session.qa[i];
  const judge = session.judges.find((j) => j.id === item.judge.id);
  const query = `${item.question} ${item.answer.slice(0, 200)}`;
  const [deckCtx, proposalCtx] = await Promise.all([
    docs.presentation ? topicContext(docs.presentation, query, 4000) : Promise.resolve("(발표자료 없음)"),
    docs.proposal ? topicContext(docs.proposal, query, 5000) : Promise.resolve("(제안자료 없음)"),
  ]);
  const answerFillers = countFillers(item.answer);
  const p = qaPrompt({
    situation: session.situation,
    judgeName: item.judge.name,
    temperament: item.judge.temperament as Temperament,
    question: item.question,
    answer: item.answer,
    answerFillers,
    deckCtx,
    proposalCtx,
    crossLint,
    talkExcerpt: talkExcerpt(session, item.question),
  });
  const r = await llmJson({ name: "qa_evaluation", ...p, schema: QASchema, effort: "high", usage });
  const s = {
    relevance: clamp(r.scores.relevance),
    accuracy: clamp(r.scores.accuracy),
    evidence: clamp(r.scores.evidence),
    completeness: clamp(r.scores.completeness),
    composure: clamp(r.scores.composure),
  };
  const score = clamp(0.25 * s.relevance + 0.25 * s.accuracy + 0.2 * s.evidence + 0.2 * s.completeness + 0.1 * s.composure);
  return {
    index: i,
    judge: { id: item.judge.id, name: item.judge.name, temperament: item.judge.temperament, imageUrl: judge?.imageUrl },
    question: item.question,
    answer: item.answer,
    scores: s,
    score,
    verdict: r.verdict,
    feedback: r.feedback,
    rationale: r.rationale,
    contradictions: groundContradictions(docs, r.contradictions),
    evidenceUsed: r.evidenceUsed,
    missing: r.missing,
    improvedAnswer: r.improvedAnswer,
    citations: groundRefs(docs, r.citations),
    answerFillers,
  };
}

const PROPOSAL_PRIORITY = ["원가-구조", "재무-계획", "시장-규모", "운영-생산", "리스크", "고객-세일즈", "비즈니스-모델", "성과-지표", "경쟁사", "투자-조건", "제품-기술", "문제-정의", "팀", "로드맵"];

async function docBody(d: DocCtx): Promise<string> {
  if (isSmall(d)) return rawText(d);
  const pages = await listWikiPages(d.docId);
  const slugs = pages.map((p) => p.slug).filter((s) => s !== "overview" && s !== "주요-수치" && !s.startsWith("질의-"));
  slugs.sort((a, b) => {
    const ia = PROPOSAL_PRIORITY.indexOf(a);
    const ib = PROPOSAL_PRIORITY.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const parts = [`### 개요 (wiki overview)\n${await wikiPage(d.docId, "overview", 6000)}`];
  let used = parts[0].length;
  const BUDGET = 28_000;
  for (const s of slugs) {
    if (used > BUDGET - 800) break;
    const body = await wikiPage(d.docId, s, Math.min(4000, BUDGET - used));
    parts.push(`### [[${s}]]\n${body}`);
    used += body.length + 10;
  }
  return `(전문 ${d.meta.chars.toLocaleString()}자 대신 LLM Wiki 페이지 요약 — 모든 사실에 원문 쪽 (p.N) 표기)\n\n${parts.join("\n\n")}`;
}

async function runDoc(
  session: SessionRecord,
  d: DocCtx,
  other: DocCtx | undefined,
  cross: Awaited<ReturnType<typeof cachedLint>>,
  self: Awaited<ReturnType<typeof cachedLint>>,
  docs: Docs,
  usage: Usage,
): Promise<DocEvaluation> {
  const p = docPrompt({
    role: d.role,
    situation: session.situation,
    filename: d.meta.filename,
    pages: d.meta.pageCount,
    body: await docBody(d),
    numbers: keyNumbersText(d),
    otherNumbers: other ? keyNumbersText(other, 60) : "",
    selfLint: lintText(self, DOC_LABEL[d.role]),
    crossLint: other ? lintText(cross, "제안자료", "발표자료") : "(상대 문서 없음)",
  });
  const r = await llmJson({ name: "doc_evaluation", ...p, schema: DocSchema, effort: "high", usage });
  const s = {
    structure: clamp(r.scores.structure),
    logic: clamp(r.scores.logic),
    evidence: clamp(r.scores.evidence),
    consistency: clamp(r.scores.consistency),
    clarity: clamp(r.scores.clarity),
  };
  return {
    role: d.role,
    docId: d.docId,
    filename: d.meta.filename,
    pageCount: d.meta.pageCount,
    scores: s,
    score: clamp(0.2 * s.structure + 0.25 * s.logic + 0.25 * s.evidence + 0.2 * s.consistency + 0.1 * s.clarity),
    summary: r.summary,
    strengths: r.strengths,
    issues: r.issues.map((i) => ({ ...i, refs: groundRefs(docs, i.refs) })),
  };
}

async function runConsistency(pres: DocCtx, prop: DocCtx, crossLint: string, usage: Usage): Promise<ConsistencyRow[]> {
  const p = consistencyPrompt({ deckNumbers: keyNumbersText(pres), proposalNumbers: keyNumbersText(prop), crossLint });
  const r = await llmJson({ name: "consistency", ...p, schema: ConsistencySchema, effort: "medium", usage });
  const fix = (d: DocCtx, v: { value: string; pages: number[] } | null) => {
    if (!v) return null;
    const pages = v.pages.map(Math.round).filter((x) => x >= 1 && x <= d.meta.pageCount);
    const found = findPages(d, v.value);
    const ok = pages.filter((x) => found.includes(x));
    return { value: v.value, pages: ok.length ? ok : found.length ? found : pages };
  };
  const rows = r.rows.map((row) => ({ ...row, presentation: fix(pres, row.presentation), proposal: fix(prop, row.proposal) }));
  const order = { mismatch: 0, "only-one": 2, match: 1 } as const;
  return rows.sort((a, b) => order[a.status] - order[b.status]);
}

async function runOverall(
  session: SessionRecord,
  m: SpeechMetrics,
  speech: SpeechAnalysis | null,
  qa: QAEvaluation[],
  docs: DocEvaluation[],
  consistency: ConsistencyRow[],
  sub: SubScores,
  total: number,
  usage: Usage,
) {
  const lines: string[] = [];
  lines.push(`## 상황\n${session.situation}`);
  lines.push(
    `## 점수 (코드 계산, 변경 금지)\n총점 ${total} / ${(Object.keys(sub) as (keyof SubScores)[]).map((k) => `${SUBSCORE_LABEL[k]} ${sub[k] ?? "-"}`).join(", ")}`,
  );
  lines.push(
    `## 전달 지표 (코드 계산)\n- 말 속도 ${m.syllablesPerMinute}음절/분 (${m.rateStatus}), 문장 ${m.sentencesPerMinute}개/분\n- 시간 사용 ${Math.round(m.timeUsage * 100)}% (${m.spokenSeconds}s / ${m.targetSeconds}s, ${m.timeStatus})\n- 군말 ${m.fillers.total}회 (분당 ${m.fillers.perMinute}): ${m.fillers.byWord.map((f) => `${f.word}×${f.count}`).join(", ") || "없음"}\n- 긴 침묵(${m.pauses.threshold}s↑) ${m.pauses.count}회, 평균 문장 ${m.avgSentenceSyllables}음절\n- 감점: ${m.deliveryPenalties.map((p) => `${p.reason} -${p.points}`).join(", ") || "없음"}`,
  );
  if (speech)
    lines.push(
      `## 발표 내용\n${speech.summary}\n구조 ${speech.scores.structure}, 명료성 ${speech.scores.clarity}, 설득력 ${speech.scores.persuasiveness}, 슬라이드 커버리지 ${Math.round(speech.coverageRate * 100)}%\n강점: ${speech.strengths.join(" / ")}\n개선: ${speech.improvements.join(" / ")}\n발표 중 수치 오류: ${speech.numberIssues.map((c) => `${c.claim} ↔ ${c.docSays}`).join(" / ") || "없음"}`,
    );
  lines.push(
    `## 질의응답\n${qa.map((q) => `- Q${q.index + 1} (${q.judge.name}) ${q.score}점 ${q.verdict}: ${q.question}\n  피드백: ${q.feedback}\n  모순: ${q.contradictions.map((c) => c.docSays).join(" / ") || "없음"}`).join("\n") || "(질문 없음)"}`,
  );
  lines.push(
    `## 자료 품질\n${docs.map((d) => `- ${DOC_LABEL[d.role]} ${d.score}점: ${d.summary}\n  주요 이슈: ${d.issues.slice(0, 3).map((i) => `${i.title}(${i.severity})`).join(", ")}`).join("\n")}\n- 덱↔제안서 불일치: ${consistency.filter((r) => r.status === "mismatch").map((r) => `${r.metric} ${r.presentation?.value}↔${r.proposal?.value}`).join(", ") || "없음"}`,
  );
  const p = overallPrompt(lines.join("\n\n"));
  return llmJson({ name: "overall", ...p, schema: OverallSchema, effort: "medium", usage });
}

async function poolMap<I, O>(items: I[], limit: number, fn: (x: I) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
