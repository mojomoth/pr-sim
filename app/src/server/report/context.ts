import "server-only";
import { docChars, readPage, wikiDocFrom, type WikiDoc } from "../wiki/store";
import { queryWiki } from "../wiki/query";
import type { KeyNumber, LintReport } from "../wiki/types";
import type { DocRole } from "../types";
import type { DocRef, ReportInput } from "./types";

// Request-local document context. All references are grounded against raw pages.
const RAW_INLINE_LIMIT = 16_000;

export interface DocCtx {
  role: DocRole;
  docId: string;
  doc: WikiDoc;
  filename: string;
  pageCount: number;
  chars: number;
  raw: string[]; // raw page texts, index 0 = p.1
  keyNumbers: KeyNumber[];
}
export interface Docs {
  presentation?: DocCtx;
  proposal?: DocCtx;
  warnings: string[];
}

export function resolveDocs(input: ReportInput): Docs {
  const out: Docs = { warnings: [] };
  for (const inputDoc of input.docs) {
    const doc = wikiDocFrom(inputDoc);
    out[inputDoc.role] = {
      role: inputDoc.role, docId: doc.docId, doc, filename: doc.filename,
      pageCount: doc.raw.length, chars: docChars(doc), raw: doc.raw, keyNumbers: doc.keyNumbers,
    };
  }
  return out;
}

/** Whole raw text with page markers (small docs), or a per-page digest capped to `budget`. */
export function rawText(doc: DocCtx, budget = RAW_INLINE_LIMIT): string {
  const total = doc.raw.reduce((a, t) => a + t.length, 0);
  const per = total <= budget ? Infinity : Math.max(120, Math.floor(budget / doc.raw.length));
  return doc.raw.map((t, i) => `[p.${i + 1}]\n${t.length > per ? t.slice(0, per) + " …" : t.trim()}`).join("\n\n");
}

export const isSmall = (doc: DocCtx) => doc.chars <= RAW_INLINE_LIMIT;

export function keyNumbersText(doc: DocCtx, max = 80): string {
  return doc.keyNumbers
    .slice(0, max)
    .map((r) => `- ${r.metric} = ${r.value} (p.${r.pages.join(",")})${r.conflict ? " ⚠문서 내 충돌" : ""}${r.note ? ` — ${r.note}` : ""}`)
    .join("\n");
}

export async function wikiPage(doc: WikiDoc, slug: string, budget = 6000): Promise<string> {
  const md = readPage(doc, slug) ?? "";
  const body = md.replace(/^---[\s\S]*?---\s*/, "").trim();
  return body.length > budget ? body.slice(0, budget) + " …" : body;
}

/** Context for a question/topic: whole raw for small docs, queryWiki slice (cited) for large ones. */
export async function topicContext(doc: DocCtx, query: string, budget = 5000): Promise<string> {
  if (isSmall(doc)) return rawText(doc);
  try {
    const r = await queryWiki(doc.doc, query, { maxContextChars: budget, maxPages: 4 });
    return r.context;
  } catch {
    const r = await queryWiki(doc.doc, query, { maxContextChars: budget, maxPages: 4, selector: "lexical" });
    return r.context;
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

export function normRaw(t: string) {
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
  const inRange = pages.filter((p) => p >= 1 && p <= doc.pageCount);
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
