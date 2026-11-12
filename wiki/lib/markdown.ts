// Pure helpers for wiki markdown (no fs; safe on client and server).

export interface Frontmatter {
  title?: string;
  type?: string;
  summary?: string;
  sources?: number[];
  updated?: string;
  [k: string]: unknown;
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

export function parseFrontmatter(md: string): { fm: Frontmatter; body: string } {
  const m = md.match(FM_RE);
  if (!m) return { fm: {}, body: md };
  const fm: Frontmatter = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        /* keep raw */
      }
    }
    if (k === "sources") {
      fm.sources = v
        .replace(/[[\]]/g, "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    } else fm[k] = v;
  }
  return { fm, body: md.slice(m[0].length) };
}

export function buildFrontmatter(fm: Frontmatter): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue;
    if (k === "sources" && Array.isArray(v)) lines.push(`sources: [${v.join(", ")}]`);
    else lines.push(`${k}: ${JSON.stringify(String(v))}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

/** [[slug]] or [[slug|label]] → slugs */
export const WIKILINK_RE = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g;

export function extractLinks(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(WIKILINK_RE)) out.add(normalizeSlug(m[1]));
  return [...out];
}

/** Citation groups like (p.12), (p.12, p.14), (p.12–14), (pp. 3-5), (p.3, 7) */
export const CITATION_RE = /\(\s*p{1,2}\.\s*\d+(?:\s*[–\-~,]\s*(?:p{1,2}\.\s*)?\d+)*\s*\)/g;

export function parseCitationGroup(s: string): number[] {
  const inner = s.replace(/^\(\s*/, "").replace(/\s*\)$/, "").replace(/p{1,2}\.\s*/g, "");
  const out: number[] = [];
  for (const part of inner.split(",")) {
    const r = part.split(/[–\-~]/).map((x) => Number(x.trim()));
    if (r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] >= r[0] && r[1] - r[0] <= 30) {
      for (let p = r[0]; p <= r[1]; p++) out.push(p);
    } else if (Number.isFinite(r[0])) out.push(r[0]);
  }
  return out.filter((n) => n > 0);
}

export function extractCitations(md: string): number[] {
  const set = new Set<number>();
  for (const m of md.matchAll(CITATION_RE)) for (const p of parseCitationGroup(m[0])) set.add(p);
  return [...set].sort((a, b) => a - b);
}

/** Canonical slug: trimmed, spaces → "-", no path chars. Korean kept as-is. */
export function normalizeSlug(s: string): string {
  return s
    .normalize("NFC")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[\\/:*?"<>|#^[\]()]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
}

export function compactPages(pages: number[]): string {
  const s = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i + 1 ? `${s[i]}–${s[j]}` : j === i + 1 ? `${s[i]}, ${s[j]}` : `${s[i]}`);
    i = j;
  }
  return parts.join(", ");
}

/** Rough token estimate. Measured on this corpus (Korean business text, OpenAI o200k): ~0.6 tok/char. */
export function approxTokens(chars: number): number {
  return Math.round(chars * 0.6);
}
