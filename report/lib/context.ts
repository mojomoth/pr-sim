import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFixture } from "@/fixtures/lib";
import type { SessionRecord } from "@/lib/types";
import { getDocMeta, getKeyNumbers, getWikiStatus, ingestPdf, lintWiki, queryWiki, readRawPage, readWikiPage, waitForWiki } from "@/wiki/lib";
import type { DocMeta, KeyNumber, LintReport } from "@/wiki/lib/types";
import type { DocRef, DocRole } from "./types";

// Document context for the report, built from the wiki PoC (Karpathy LLM Wiki):
//  - small docs (deck): whole raw text with [p.N] markers (lossless, ~3k chars)
//  - large docs (proposal): wiki overview + key-number table + queryWiki() slices per question
//  - lint (self + cross-doc) cached under .data/report/lint keyed by the wiki's updatedAt
// Every page ref the LLM returns is re-grounded against the immutable raw pages (groundRefs).

export const REPORT_DIR = path.join(process.cwd(), ".data", "report");
const RAW_INLINE_LIMIT = 16_000;

export interface DocCtx {
  role: DocRole;
  docId: string;
  meta: DocMeta;
  raw: string[]; // raw page texts, index 0 = p.1
  keyNumbers: KeyNumber[];
}
export interface Docs {
  presentation?: DocCtx;
  proposal?: DocCtx;
  warnings: string[];
}

async function loadDoc(role: DocRole, docId: string): Promise<DocCtx | null> {
  const st = await getWikiStatus(docId);
  if (!st) return null;
  if (st.state !== "ready") await waitForWiki(docId);
  const meta = await getDocMeta(docId);
  if (!meta) return null;
  const raw = await Promise.all(Array.from({ length: meta.pageCount }, (_, i) => readRawPage(docId, i + 1).then((t) => t ?? "")));
  return { role, docId, meta, raw, keyNumbers: await getKeyNumbers(docId) };
}

/** Resolve the session's documents; if docIds are missing, ingest the fixture PDFs via the wiki lib (instant when already ingested). */
export async function resolveDocs(session: SessionRecord): Promise<Docs> {
  const warnings: string[] = [];
  const out: Docs = { warnings };
  const want: [DocRole, string | undefined, "presentationPdf" | "proposalPdf", string][] = [
    ["presentation", session.presentationDocId, "presentationPdf", "presentation.pdf"],
    ["proposal", session.proposalDocId, "proposalPdf", "proposal.pdf"],
  ];
  await Promise.all(
    want.map(async ([role, id, fixture, filename]) => {
      let docId = id;
      if (docId && !(await getWikiStatus(docId))) {
        warnings.push(`${role} docId ${docId}가 위키에 없어 픽스처 PDF로 대체했습니다.`);
        docId = undefined;
      }
      if (!docId) {
        if (id === undefined) warnings.push(`세션에 ${role === "presentation" ? "발표자료" : "제안자료"} docId가 없어 픽스처 ${filename}를 위키로 인제스트(재사용)했습니다.`);
        const r = await ingestPdf(await readFixture(fixture), filename, { kind: role });
        docId = r.docId;
      }
      const ctx = await loadDoc(role, docId);
      if (ctx) out[role] = ctx;
    }),
  );
  return out;
}

/** Whole raw text with page markers (small docs), or a per-page digest capped to `budget`. */
export function rawText(doc: DocCtx, budget = RAW_INLINE_LIMIT): string {
  const total = doc.raw.reduce((a, t) => a + t.length, 0);
  const per = total <= budget ? Infinity : Math.max(120, Math.floor(budget / doc.raw.length));
  return doc.raw.map((t, i) => `[p.${i + 1}]\n${t.length > per ? t.slice(0, per) + " …" : t.trim()}`).join("\n\n");
}

export const isSmall = (doc: DocCtx) => doc.meta.chars <= RAW_INLINE_LIMIT;

export function keyNumbersText(doc: DocCtx, max = 80): string {
  return doc.keyNumbers
    .slice(0, max)
    .map((r) => `- ${r.metric} = ${r.value} (p.${r.pages.join(",")})${r.conflict ? " ⚠문서 내 충돌" : ""}${r.note ? ` — ${r.note}` : ""}`)
    .join("\n");
}

export async function wikiPage(docId: string, slug: string, budget = 6000): Promise<string> {
  const md = (await readWikiPage(docId, slug)) ?? "";
  const body = md.replace(/^---[\s\S]*?---\s*/, "").trim();
  return body.length > budget ? body.slice(0, budget) + " …" : body;
}

/** Context for a question/topic: whole raw for small docs, queryWiki slice (cited) for large ones. */
export async function topicContext(doc: DocCtx, query: string, budget = 5000): Promise<string> {
  if (isSmall(doc)) return rawText(doc);
  try {
    const r = await queryWiki(doc.docId, query, { maxContextChars: budget, maxPages: 4 });
    return r.context;
  } catch {
    const r = await queryWiki(doc.docId, query, { maxContextChars: budget, maxPages: 4, selector: "lexical" });
    return r.context;
  }
}

/** lintWiki with a file cache keyed by the wiki's last update (lint is an LLM pass, 15–20 s). */
export async function cachedLint(docId: string, against?: string): Promise<LintReport | null> {
  const [a, b] = await Promise.all([getWikiStatus(docId), against ? getWikiStatus(against) : null]);
  const stamp = `${a?.finishedAt ?? a?.updatedAt}|${b?.finishedAt ?? b?.updatedAt ?? ""}`;
  const file = path.join(REPORT_DIR, "lint", `${docId}${against ? `-vs-${against}` : ""}.json`);
  try {
    const c = JSON.parse(await readFile(file, "utf8")) as { stamp: string; report: LintReport };
    if (c.stamp === stamp) return c.report;
  } catch {}
  try {
    const report = await lintWiki(docId, against ? { against } : {});
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ stamp, report }, null, 1));
    return report;
  } catch {
    return null;
  }
}

export function lintText(r: LintReport | null, label: string, otherLabel?: string): string {
  if (!r) return "(점검 결과 없음)";
  const rows = r.issues.filter((i) => i.type !== "orphan" && i.type !== "broken-link" && i.severity !== "low");
  if (!rows.length) return "(주요 이슈 없음)";
  return rows
    .map((i) => `- [${i.severity}/${i.type}] ${i.message} (${label} p.${i.citations.join(",") || "?"}${i.otherCitations?.length ? `; ${otherLabel} p.${i.otherCitations.join(",")}` : ""})`)
    .join("\n");
}

// ───────────────────────── page re-grounding ─────────────────────────

/** Distinctive figures in a string ("142원", "340억", "3.1%", "25만", "92"), normalized without spaces/commas. */
export function figures(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(/\d[\d,.]*\s?(?:원|억|조|만|%|퍼센트|곳|배|세트|건|개월|년|톤)?/g)) {
    let t = m[0].replace(/[\s,]/g, "").replace(/퍼센트$/, "%");
    t = t.replace(/\.$/, "");
    if (t.replace(/\D/g, "").length >= 2 || /[%원억]$/.test(t)) out.add(t);
  }
  return [...out];
}

function normRaw(t: string) {
  return t.replace(/(\d),(\d)/g, "$1$2").replace(/\s+/g, "").replace(/퍼센트/g, "%");
}

/** Pages whose raw text contains the most of the value's figures (≥1). */
export function findPages(doc: DocCtx, value: string, max = 4): number[] {
  const toks = figures(value);
  if (!toks.length) return [];
  const scored = doc.raw
    .map((t, i) => {
      const n = normRaw(t);
      return { p: i + 1, c: toks.filter((k) => n.includes(k)).length };
    })
    .filter((x) => x.c > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.c));
  return scored
    .filter((x) => x.c === best)
    .slice(0, max)
    .map((x) => x.p);
}

/**
 * Re-ground a DocRef against raw text: keep LLM pages that actually contain the value; otherwise replace with pages
 * found by searching the raw text. `grounded` tells the UI whether the value was verified on those pages.
 */
export function groundRef(docs: Docs, ref: DocRef): DocRef {
  const value = ref.quote ?? null;
  const doc = docs[ref.doc];
  const pages = [...new Set(ref.pages.map(Math.round))];
  if (!doc) return { ...ref, pages, grounded: false };
  const inRange = pages.filter((p) => p >= 1 && p <= doc.meta.pageCount);
  if (!value) return { ...ref, pages: inRange, grounded: false };
  const toks = figures(value);
  if (toks.length) {
    const keep = inRange.filter((p) => toks.some((k) => normRaw(doc.raw[p - 1] ?? "").includes(k)));
    if (keep.length) return { ...ref, pages: keep.slice(0, 6), grounded: true };
    const found = findPages(doc, value);
    if (found.length) return { ...ref, pages: found, grounded: true };
  }
  // text quote without figures (or figures not found): Hangul word overlap ≥ 60 %
  const words = [...new Set(value.match(/[가-힣A-Za-z]{2,}/g) ?? [])];
  if (words.length) {
    const hit = (p: number) => {
      const n = normRaw(doc.raw[p - 1] ?? "");
      return words.filter((w) => n.includes(w)).length / words.length >= 0.6;
    };
    const keep = inRange.filter(hit);
    if (keep.length) return { ...ref, pages: keep.slice(0, 6), grounded: true };
    if (!toks.length) {
      const found = doc.raw.map((_, i) => i + 1).filter(hit).slice(0, 4);
      if (found.length) return { ...ref, pages: found, grounded: true };
    }
  }
  return { ...ref, pages: inRange, grounded: false };
}
