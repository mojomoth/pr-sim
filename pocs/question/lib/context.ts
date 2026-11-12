import "server-only";
import { createHash } from "node:crypto";
import path from "node:path";
import { getDocMeta, getKeyNumbers, getWikiStatus, lintWiki, queryWiki, readRawPage } from "@/wiki/lib";
import type { KeyNumber, LintIssue } from "@/wiki/lib/types";
import type { TranscriptSentence } from "@/lib/types";
import { LINT_DIR, readJson, writeJson } from "./store";
import { approxTokens, firstValue, keywords, mmss, norm, numberTokens, similarity, stripFillers } from "./text";
import type { ContextPack, ContextSection, FocusTarget, GenerateInput, RawPageRef, WikiQueryLog } from "./types";

// buildContext: everything the judges see. Deterministic (no LLM in the hot path except the cached
// cross-doc lint): transcript claims → wiki lexical queries on BOTH docs → raw source pages for verbatim
// evidence → key-number cross-check + wiki lint issues → focus targets.

type DocRole = "presentation" | "proposal";
const DOC_LABEL: Record<DocRole, string> = { presentation: "발표자료", proposal: "제안자료" };

export const BUDGET = {
  transcript: 9000,
  wiki: { presentation: 3000, proposal: 5000 },
  rawFullDocMax: 6000, // whole doc raw included if it is this small (pitch decks)
  rawPages: 6, // max raw pages per large doc
  rawPageChars: 1900,
  claims: 6,
  targets: 12,
};

// ---------------------------------------------------------------------------------------------
// Raw pages (immutable source text) — cached per docId
// ---------------------------------------------------------------------------------------------
const rawCache = new Map<string, Promise<string[]>>();
export function rawPages(docId: string): Promise<string[]> {
  let p = rawCache.get(docId);
  if (!p) {
    p = (async () => {
      const meta = await getDocMeta(docId);
      if (!meta) throw new Error(`unknown docId ${docId}`);
      return Promise.all(Array.from({ length: meta.pageCount }, (_, i) => readRawPage(docId, i + 1).then((t) => t ?? "")));
    })();
    rawCache.set(docId, p);
    p.catch(() => rawCache.delete(docId));
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------------------------
export function transcriptText(ts: TranscriptSentence[], max = BUDGET.transcript): string {
  const lines = ts.filter((s) => s.phase === "presentation").map((s) => `[전사 ${mmss(s.t)}] ${s.text.trim()}`);
  const full = lines.join("\n");
  if (full.length <= max) return full;
  // keep head + tail, drop the middle (long talks): judges mostly need the claims; numbers dominate
  const head: string[] = [];
  const tail: string[] = [];
  let h = 0;
  let t = 0;
  for (const l of lines) {
    if (h + l.length > max / 2) break;
    head.push(l);
    h += l.length + 1;
  }
  for (let i = lines.length - 1; i >= head.length; i--) {
    if (t + lines[i].length > max / 2) break;
    tail.unshift(lines[i]);
    t += lines[i].length + 1;
  }
  return `${head.join("\n")}\n[… 전사 ${lines.length - head.length - tail.length}문장 생략 …]\n${tail.join("\n")}`;
}

const CLAIM_WORDS = /(원가|매출|이익|시장|점유|고객|재구매|공장|생산|투자|기업가치|런웨이|특허|경쟁|가격|판매가|계약|LOI|목표|성장|흑자|리스크|공급|규제|배)/;

/** Claim sentences: the ones carrying numbers / business claims (fillers stripped). */
export function extractClaims(ts: TranscriptSentence[], n = BUDGET.claims): { text: string; t: number; score: number }[] {
  const scored = ts
    .filter((s) => s.phase === "presentation")
    .map((s) => {
      const text = stripFillers(s.text);
      const nums = numberTokens(text).filter((x) => !/^\d{4}년$/.test(x)).length;
      const kw = (text.match(new RegExp(CLAIM_WORDS, "g")) ?? []).length;
      return { text, t: s.t, score: nums * 2 + kw };
    })
    .filter((c) => c.score >= 3 && c.text.length >= 10);
  // pick top-n, but avoid near-duplicate topics
  const picked: typeof scored = [];
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    if (picked.some((p) => similarity(p.text, c.text) > 0.45)) continue;
    picked.push(c);
    if (picked.length >= n) break;
  }
  return picked.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------------------------
// Wiki queries (lexical selector: 0 LLM calls, ~ms) and section dedupe
// ---------------------------------------------------------------------------------------------
const RISK_QUERY = "핵심 리스크와 검증되지 않은 가정 (공급처, 생산능력, 성장 근거)";
const NUMBERS_QUERY = "주요 수치: 원가, 매출총이익률, 시장 규모(SOM), 매출 계획, 투자 조건";

function splitSections(context: string): { slug: string; body: string }[] {
  const parts = context.split(/(?=^### \[\[)/m).filter((p) => p.trim());
  return parts.map((p) => ({ slug: p.match(/^### \[\[([^\]]+)\]\]/)?.[1] ?? p.slice(0, 30), body: p.trim() }));
}

async function queryDoc(role: DocRole, docId: string, queries: { q: string; purpose: WikiQueryLog["purpose"] }[]) {
  const logs: WikiQueryLog[] = [];
  const sections = new Map<string, { body: string; hits: number; order: number }>();
  let order = 0;
  for (const { q, purpose } of queries) {
    const t0 = Date.now();
    const r = await queryWiki(docId, q, { selector: "lexical", maxContextChars: 2400, maxPages: 2, includeRaw: false, followLinks: false });
    logs.push({ doc: role, docId, purpose, query: q, pages: r.pages, contextChars: r.contextChars, ms: Date.now() - t0 });
    for (const s of splitSections(r.context)) {
      const cur = sections.get(s.slug);
      if (cur) {
        cur.hits++;
        if (s.body.length > cur.body.length) cur.body = s.body;
      } else sections.set(s.slug, { body: s.body, hits: 1, order: order++ });
    }
  }
  const budget = BUDGET.wiki[role];
  const ranked = [...sections.entries()].sort((a, b) => b[1].hits - a[1].hits || a[1].order - b[1].order);
  let text = "";
  const used: string[] = [];
  for (const [slug, s] of ranked) {
    const room = budget - text.length;
    if (room < 300) break;
    const body = s.body.length > room ? `${s.body.slice(0, room - 20)}\n_(이하 생략)_` : s.body;
    text += (text ? "\n\n" : "") + body;
    used.push(slug);
  }
  return { logs, text, used };
}

// ---------------------------------------------------------------------------------------------
// Cross-doc checks: deterministic key-number comparison + (cached) wiki lint
// ---------------------------------------------------------------------------------------------
export interface NumberConflict {
  metricA: string;
  metricB: string;
  a: KeyNumber;
  b: KeyNumber;
  sim: number;
}

export function compareKeyNumbers(a: KeyNumber[], b: KeyNumber[]): NumberConflict[] {
  const out: NumberConflict[] = [];
  for (const x of a) {
    const vx = firstValue(x.value);
    if (!vx || !vx.u || vx.u === "년") continue;
    let best: { k: KeyNumber; sim: number } | null = null;
    for (const y of b) {
      const sim = similarity(x.metric, y.metric);
      if (sim >= 0.6 && (!best || sim > best.sim)) best = { k: y, sim };
    }
    if (!best) continue;
    const vy = firstValue(best.k.value);
    if (!vy || vy.u !== vx.u) continue;
    const diff = Math.abs(vx.n - vy.n) / Math.max(Math.abs(vx.n), Math.abs(vy.n), 1e-9);
    if (diff > 0.03) out.push({ metricA: x.metric, metricB: best.k.metric, a: x, b: best.k, sim: best.sim });
  }
  // strongest name matches first, dedupe by metric
  const seen = new Set<string>();
  return out.sort((p, q) => q.sim - p.sim).filter((c) => (seen.has(c.metricA) ? false : (seen.add(c.metricA), true))).slice(0, 8);
}

const lintInflight = new Map<string, Promise<{ issues: LintIssue[]; cached: boolean; ms: number }>>();

/** Wiki lint (LLM, ~15–20 s) cached on disk per doc pair; the wiki index mtime is not tracked (PoC). */
export function cachedLint(docId: string, against?: string): Promise<{ issues: LintIssue[]; cached: boolean; ms: number }> {
  const key = against ? `${docId}-vs-${against}` : docId;
  const file = path.join(LINT_DIR, `${key}.json`);
  let p = lintInflight.get(key);
  if (!p) {
    p = (async () => {
      const t0 = Date.now();
      const hit = await readJson<{ issues: LintIssue[] }>(file);
      if (hit) return { issues: hit.issues, cached: true, ms: Date.now() - t0 };
      const r = await lintWiki(docId, against ? { against } : {});
      await writeJson(file, { docId, against, issues: r.issues, checkedAt: r.checkedAt, ms: r.ms });
      return { issues: r.issues, cached: false, ms: Date.now() - t0 };
    })();
    lintInflight.set(key, p);
    p.finally(() => lintInflight.delete(key));
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Raw page selection for verbatim evidence
// ---------------------------------------------------------------------------------------------
function scorePage(text: string, nums: string[], kws: string[]): number {
  const t = text.normalize("NFKC").replace(/,/g, "");
  let s = 0;
  for (const n of nums) if (t.includes(n)) s += /\D/.test(n) ? 3 : 1;
  for (const k of kws) if (t.includes(k)) s += 0.4;
  return s;
}

function trimPage(text: string, nums: string[], max: number): string {
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= max) return clean;
  // window around the first matched number
  const idx = nums.map((n) => clean.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(idx - max / 3, clean.length - max));
  return `${start > 0 ? "…" : ""}${clean.slice(start, start + max)}…`;
}

// ---------------------------------------------------------------------------------------------
// buildContext
// ---------------------------------------------------------------------------------------------
export async function buildContext(input: GenerateInput, onStage?: (msg: string) => void): Promise<ContextPack> {
  const t0 = Date.now();
  const docs: { role: DocRole; id: string }[] = [];
  for (const [role, id] of [["presentation", input.presentationDocId], ["proposal", input.proposalDocId]] as const) {
    if (!id) continue;
    const st = await getWikiStatus(id);
    if (!st) throw new Error(`위키 문서를 찾을 수 없습니다: ${id}`);
    if (st.state !== "ready") throw new Error(`${DOC_LABEL[role]} 위키가 아직 준비되지 않았습니다 (${st.state})`);
    docs.push({ role, id });
  }

  const transcript = transcriptText(input.transcript);
  const claims = extractClaims(input.transcript);
  const queries: { q: string; purpose: WikiQueryLog["purpose"] }[] = [
    ...claims.map((c) => ({ q: c.text, purpose: "claim" as const })),
    { q: NUMBERS_QUERY, purpose: "numbers" },
    { q: RISK_QUERY, purpose: "risk" },
  ];

  // lint starts first (slowest, cached) and runs while we query the wikis
  const pres = docs.find((d) => d.role === "presentation")?.id;
  const prop = docs.find((d) => d.role === "proposal")?.id;
  const lintP = input.fastContext || !docs.length
    ? Promise.resolve({ issues: [] as LintIssue[], cached: false, ms: 0, used: false })
    : cachedLint(prop ?? pres!, prop && pres ? pres : undefined).then((r) => ({ ...r, used: true })).catch((e) => {
        console.warn("[question] lint failed:", e instanceof Error ? e.message : e);
        return { issues: [] as LintIssue[], cached: false, ms: 0, used: false };
      });

  onStage?.(`위키 질의 ${queries.length * docs.length}건 (전사 주장 ${claims.length} + 수치·리스크)`);
  const wiki = await Promise.all(docs.map((d) => queryDoc(d.role, d.id, queries)));
  const [kn, raws] = await Promise.all([
    Promise.all(docs.map((d) => getKeyNumbers(d.id).catch(() => [] as KeyNumber[]))),
    Promise.all(docs.map((d) => rawPages(d.id))),
  ]);
  const knOf = (role: DocRole) => kn[docs.findIndex((d) => d.role === role)] ?? [];
  const conflicts = pres && prop ? compareKeyNumbers(knOf("presentation"), knOf("proposal")) : [];

  onStage?.(input.fastContext ? "교차 검토(수치 비교만)" : "교차 검토(위키 lint, 캐시 사용)");
  const lint = await lintP;
  const lintIssues = lint.issues.filter((i) => ["cross-doc-mismatch", "contradiction", "gap"].includes(i.type) && i.severity !== "low");

  // ---- focus targets ----
  // Lint messages come from an LLM and sometimes carry its own arithmetic (seen: "월 25만 세트 → 연 30억~49.5억 원",
  // really ≈4.95억). Numbers in a lint message that appear nowhere in the source text are flagged so judges
  // (and the inspector) treat them as unverified instead of quoting them.
  const sourceNorm = norm([...raws.flat(), ...input.transcript.map((x) => x.text)].join(" ")).replace(/,/g, "");
  const unsourced = (detail: string) =>
    numberTokens(detail).filter((n) => /[억만원%세트]/.test(n) && !/^\d{4}년$/.test(n) && !sourceNorm.includes(norm(n)));
  const targets: FocusTarget[] = [];
  const push = (t: Omit<FocusTarget, "id">) => targets.length < BUDGET.targets && targets.push({ ...t, id: `t${targets.length + 1}` });
  const lintRole: DocRole = prop ? "proposal" : "presentation";
  for (const i of lintIssues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1))) {
    const bad = unsourced(i.message);
    push({
      kind: i.type === "cross-doc-mismatch" ? "mismatch" : "gap",
      title: i.type === "cross-doc-mismatch" ? "자료 간 불일치" : i.type === "contradiction" ? "자료 내 모순" : "근거 부족·검증 공백",
      detail: bad.length ? `${i.message} ⚠ 원문에 없는 수치 ${bad.join(", ")}: 자동 점검(LLM)이 계산한 값이라 틀릴 수 있음. 인용·질문 전 원문 수치로 직접 다시 계산할 것.` : i.message,
      ...(bad.length ? { unverifiedNumbers: bad } : {}),
      severity: i.severity,
      refs: [
        { doc: lintRole, pages: i.citations.slice(0, 6) },
        ...(i.otherCitations?.length ? [{ doc: "presentation" as const, pages: i.otherCitations.slice(0, 6) }] : []),
      ],
    });
  }
  for (const c of conflicts) {
    const covered = targets.some((t) => t.kind === "mismatch" && numberTokens(t.detail).some((n) => c.a.value.replace(/\s/g, "").includes(n) || c.b.value.replace(/\s/g, "").includes(n)));
    if (covered) continue;
    push({
      kind: "number-conflict",
      title: `수치 차이: ${c.metricA}`,
      detail: `발표자료 "${c.metricA}" ${c.a.value} (p.${c.a.pages.join(",")}) vs 제안자료 "${c.metricB}" ${c.b.value} (p.${c.b.pages.join(",")})`,
      severity: "medium",
      refs: [
        { doc: "presentation", pages: c.a.pages },
        { doc: "proposal", pages: c.b.pages },
      ],
    });
  }
  for (const c of claims) push({ kind: "claim", title: "발표 주장", detail: `${mmss(c.t)} "${c.text}"`, severity: "low", refs: [{ doc: "transcript", pages: [] }] });

  // ---- raw pages for verbatim evidence ----
  const rawRefs: RawPageRef[] = [];
  const rawBlocks: string[] = [];
  const claimText = claims.map((c) => c.text).join(" ");
  const targetText = targets.map((t) => t.detail).join(" ");
  const nums = [...new Set([...numberTokens(claimText), ...numberTokens(targetText)])].filter((n) => !/^\d{1,2}$/.test(n));
  const kws = keywords(`${claimText} ${targetText}`).slice(0, 60);
  docs.forEach((d, di) => {
    const pages = raws[di];
    const total = pages.reduce((s, p) => s + p.length, 0);
    if (total <= BUDGET.rawFullDocMax) {
      pages.forEach((text, i) => {
        if (!text.trim()) return;
        rawRefs.push({ doc: d.role, page: i + 1, chars: text.length, score: 0, reason: "문서 전체(소형)" });
        rawBlocks.push(`[원문 ${DOC_LABEL[d.role]} p.${i + 1}]\n${text.replace(/[ \t]+/g, " ").trim()}`);
      });
      return;
    }
    const boost = new Map<number, number>();
    for (const t of targets) for (const r of t.refs) if (r.doc === d.role) for (const p of r.pages) boost.set(p, (boost.get(p) ?? 0) + (t.severity === "high" ? 2 : 1));
    const ranked = pages
      .map((text, i) => ({ page: i + 1, text, score: scorePage(text, nums, kws) + (boost.get(i + 1) ?? 0) }))
      .filter((p) => p.text.trim().length > 50 && p.page > 2) // skip cover/TOC
      .sort((a, b) => b.score - a.score)
      .slice(0, BUDGET.rawPages)
      .sort((a, b) => a.page - b.page);
    for (const p of ranked) {
      const body = trimPage(p.text, nums, BUDGET.rawPageChars);
      rawRefs.push({ doc: d.role, page: p.page, chars: body.length, score: Math.round(p.score * 10) / 10, reason: boost.has(p.page) ? "검토 포인트 인용 쪽 + 수치 일치" : "전사 수치·키워드 일치" });
      rawBlocks.push(`[원문 ${DOC_LABEL[d.role]} p.${p.page}]\n${body}`);
    }
  });

  // ---- render ----
  const sectionsText: { key: ContextSection["key"]; title: string; text: string }[] = [];
  sectionsText.push({ key: "situation", title: "상황", text: input.situation.trim() || "(상황 설명 없음)" });
  sectionsText.push({ key: "transcript", title: `발표 음성 전사 (STT, ${input.transcript.filter((s) => s.phase === "presentation").length}문장, 동음이의 오류 가능)`, text: transcript || "(전사 없음)" });
  if (targets.length)
    sectionsText.push({
      key: "targets",
      title: "검토 포인트 후보 (자동 탐지 — 반드시 원문으로 확인 후 사용)",
      text: targets
        .map((t) => `- ${t.id} [${t.title}·${t.severity}] ${t.detail}${t.refs.filter((r) => r.pages.length).map((r) => ` (${r.doc === "transcript" ? "전사" : DOC_LABEL[r.doc as DocRole]} p.${r.pages.join(",")})`).join("")}`)
        .join("\n"),
    });
  docs.forEach((d, i) => {
    if (wiki[i].text) sectionsText.push({ key: d.role === "presentation" ? "presentation-wiki" : "proposal-wiki", title: `${DOC_LABEL[d.role]} 위키 요약 (출처 p.N은 원문 쪽)`, text: wiki[i].text });
  });
  if (rawBlocks.length) sectionsText.push({ key: "raw", title: "원문 쪽 (evidence.quote는 여기 또는 전사에서만 그대로 인용)", text: rawBlocks.join("\n\n") });

  const text = `# 심사 자료\n\n${sectionsText.map((s) => `## ${s.title}\n${s.text}`).join("\n\n")}`;
  const sections: ContextSection[] = sectionsText.map((s) => ({ key: s.key, title: s.title, chars: s.text.length, approxTokens: approxTokens(s.text.length) }));
  const fullChars = (role: DocRole) => {
    const i = docs.findIndex((d) => d.role === role);
    return i < 0 ? 0 : raws[i].reduce((s, p) => s + p.length, 0);
  };

  return {
    id: createHash("sha256").update(text).digest("hex").slice(0, 12),
    createdAt: new Date().toISOString(),
    situation: input.situation,
    transcriptSentences: input.transcript.length,
    presentationDocId: pres,
    proposalDocId: prop,
    queries: wiki.flatMap((w) => w.logs),
    rawPages: rawRefs,
    targets,
    sections,
    text,
    chars: text.length,
    approxTokens: approxTokens(text.length),
    fullTextChars: { presentation: fullChars("presentation"), proposal: fullChars("proposal"), transcript: input.transcript.reduce((s, x) => s + x.text.length, 0) },
    lint: { used: lint.used, cached: lint.cached, ms: lint.ms, issues: lintIssues.length },
    ms: Date.now() - t0,
  };
}
