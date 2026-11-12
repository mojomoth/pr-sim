import "server-only";
import type { DocInput } from "../types";
import { buildFrontmatter, compactPages, extractCitations, extractLinks, normalizeSlug, parseFrontmatter } from "./markdown";
import type { DocKind, KeyNumber, PageType, WikiPage, WikiPageInfo } from "./types";

// In-memory wiki for one request (the server is stateless: the client keeps pages in IndexedDB and sends them back).
//   raw   = immutable page texts from pdf.js (index 0 = p.1)
//   pages = slug → markdown WITH frontmatter (content pages + "index" + "SCHEMA" while building)

export interface WikiDoc {
  docId: string;
  filename: string;
  kind: DocKind;
  raw: string[];
  pages: Map<string, string>;
  keyNumbers: KeyNumber[];
}

export const RESERVED = new Set(["index", "log", "log-queries", "schema", "overview", "주요-수치"]);
/** Meta files that are not content pages. */
const META_SLUGS = ["index", "SCHEMA"];

export const docChars = (doc: WikiDoc) => doc.raw.reduce((a, t) => a + t.length, 0);

function key(slug: string): string | null {
  if (slug === "SCHEMA" || slug === "schema") return "SCHEMA";
  const s = normalizeSlug(slug);
  return s && !s.includes("..") ? s : null;
}

export function readPage(doc: WikiDoc, slug: string): string | null {
  const k = key(slug);
  return k ? (doc.pages.get(k) ?? null) : null;
}

export function writePage(doc: WikiDoc, slug: string, md: string) {
  const k = key(slug);
  if (!k) throw new Error(`unsafe slug: ${slug}`);
  doc.pages.set(k, md);
}

function pageInfoOf(slug: string, md: string): WikiPageInfo {
  const { fm, body } = parseFrontmatter(md);
  const title = fm.title ?? body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug;
  const type = (fm.type as PageType) ?? (slug === "index" || slug === "SCHEMA" ? "meta" : "topic");
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

/** Content pages (excludes index/SCHEMA), with parsed metadata. */
export function listPages(doc: WikiDoc, opts: { includeMeta?: boolean } = {}): WikiPageInfo[] {
  const order = (p: WikiPageInfo) => (p.slug === "overview" ? 0 : p.slug === "주요-수치" ? 1 : p.type === "analysis" ? 3 : 2);
  return [...doc.pages]
    .filter(([s]) => opts.includeMeta || !META_SLUGS.includes(s))
    .map(([s, md]) => pageInfoOf(s, md))
    .sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title, "ko"));
}

/** index is rebuilt deterministically from page frontmatter (LLM-written summaries). */
export function rebuildIndex(doc: WikiDoc) {
  const pages = listPages(doc);
  const range = (s: number[]) => {
    if (!s.length) return "";
    const parts = compactPages(s).split(", ");
    return ` (p.${parts.slice(0, 4).join(", p.")}${parts.length > 4 ? ` 외 ${parts.length - 4}곳` : ""})`;
  };
  const line = (p: WikiPageInfo) => `- [[${p.slug}${p.title && p.title !== p.slug ? `|${p.title}` : ""}]] — ${p.summary || "요약 없음"}${range(p.sources)}`;
  const groups: [string, (p: WikiPageInfo) => boolean][] = [
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
  writePage(
    doc,
    "index",
    `${buildFrontmatter({ title: "인덱스", type: "meta", updated: new Date().toISOString() })}# index — ${doc.filename}

> 이 위키의 모든 페이지 카탈로그 · 페이지 ${pages.length}개 · 원문 ${doc.raw.length}쪽. 질의 시 먼저 이 파일을 읽고 필요한 페이지를 고른다.

${sections}`,
  );
}

const clean = (t: string) =>
  t
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Wrap a request's DocInput as an in-memory wiki (index rebuilt from the pages it carries). */
export function wikiDocFrom(input: DocInput): WikiDoc {
  const doc: WikiDoc = {
    docId: input.docId,
    filename: input.filename,
    kind: input.role,
    raw: input.pageTexts.map(clean),
    pages: new Map(),
    keyNumbers: input.keyNumbers ?? [],
  };
  for (const p of input.wiki ?? []) {
    const slug = normalizeSlug(p.slug);
    if (!slug || META_SLUGS.includes(slug)) continue;
    writePage(doc, slug, buildFrontmatter({ title: p.title, type: p.type, summary: p.summary, sources: p.sources }) + p.markdown.trim() + "\n");
  }
  if (doc.pages.size) rebuildIndex(doc);
  return doc;
}

/** Content pages for the client (frontmatter stripped into fields). */
export function toWikiPages(doc: WikiDoc): WikiPage[] {
  return listPages(doc).map((p) => ({
    slug: p.slug,
    title: p.title,
    type: p.type,
    summary: p.summary,
    sources: p.sources,
    markdown: parseFrontmatter(readPage(doc, p.slug) ?? "").body.trim(),
  }));
}
