import "server-only";
// Deterministic citation grounding for wiki page bodies (pure, no fs/LLM).
//
// For every citation group "(p.N…)" we look at the text segment it closes and take the figures in it
// ("148원", "25만", "72%"). A figure that none of the cited raw pages contains but some other raw page does
// is a mis-citation (typically the extractor cited a neighbouring page, or an out-of-chunk page was clamped).
// We ADD the page(s) that state it — nearest to the original citation — and keep the original pages, because
// they often support the non-numeric part of the claim. Figures found nowhere in the source (derived/computed
// values) are left alone.

import { CITATION_RE, compactPages, parseCitationGroup } from "/Users/jyl/work/study/pr-sim/app/src/server/wiki/markdown.ts";
import { figuresOf } from "/Users/jyl/work/study/pr-sim/app/src/server/wiki/numbers-verify.ts";

// same normalisation as numbers-verify ("6,800 억" → "6800억", "18.0만" → "18만")
export const normRaw = (s: string) =>
  s
    .normalize("NFC")
    .replace(/[\s,]/g, "")
    .replace(/(\d)\.0+(?!\d)/g, "$1");

/** Figures worth checking: at least two digits (a bare "3개" is too ambiguous to re-ground). */
export function checkableFigures(segment: string): string[] {
  return figuresOf(segment).filter((f) => f.replace(/\D/g, "").length >= 2);
}

const formatCitation = (pages: number[]) => `(p.${compactPages(pages).replace(/, /g, ", p.")})`;

/** Pages that should be cited for `figs` given the already-cited `cited` pages, or [] if nothing to add. */
function groundingPages(figs: string[], cited: number[], rawNorm: string[], maxAdd = 3): number[] {
  const missing = figs.filter((f) => !cited.some((p) => rawNorm[p - 1]?.includes(f)));
  if (!missing.length) return [];
  const add: number[] = [];
  let todo = missing.filter((f) => rawNorm.some((t) => t.includes(f)));
  const dist = (p: number) => (cited.length ? Math.min(...cited.map((c) => Math.abs(c - p))) : p);
  while (todo.length && add.length < maxAdd) {
    let best = -1;
    let bestCover = 0;
    for (let i = 0; i < rawNorm.length; i++) {
      const p = i + 1;
      if (add.includes(p) || cited.includes(p)) continue;
      const cover = todo.filter((f) => rawNorm[i].includes(f)).length;
      if (cover > bestCover || (cover === bestCover && cover > 0 && dist(p) < dist(best))) {
        best = p;
        bestCover = cover;
      }
    }
    if (best < 0 || !bestCover) break;
    add.push(best);
    todo = todo.filter((f) => !rawNorm[best - 1].includes(f));
  }
  return add;
}

interface RegroundStats {
  groups: number; // citation groups with checkable figures
  fixed: number; // groups that got pages added
  added: number; // pages added in total
}

/** Rewrites citation groups in `body` so each figure is supported by at least one cited page when possible. */
export function regroundCitations(body: string, rawPages: string[]): { body: string; stats: RegroundStats } {
  const rawNorm = rawPages.map((t) => normRaw(t ?? ""));
  const stats: RegroundStats = { groups: 0, fixed: 0, added: 0 };
  const out = body.split("\n").map((line) => {
    if (!line.includes("p.")) return line;
    let last = 0;
    return line.replace(CITATION_RE, (m: string, offset: number) => {
      const seg = line.slice(last, offset);
      last = offset + m.length;
      const cited = parseCitationGroup(m).filter((p) => p >= 1 && p <= rawPages.length);
      const figs = checkableFigures(seg);
      if (!figs.length || !cited.length) return m;
      stats.groups++;
      const add = groundingPages(figs, cited, rawNorm);
      if (!add.length) return m;
      stats.fixed++;
      stats.added += add.length;
      return formatCitation([...cited, ...add]);
    });
  });
  return { body: out.join("\n"), stats };
}

// ---- index summaries
// Merge rounds sometimes return a summary of the EDIT ("…를 추가", "기존 내용과 동일") instead of the page.
const DELTA_RE = /기존\s?(내용|본문|페이지)|이번\s?(라운드|청크|추가)|이미\s?(반영|포함)|반영(돼|되어|됨)|동일|변경\s?없|추가(했|함|됨)?$|(을|를)\s?(추가|보강|반영|갱신|업데이트|수정)|보강|반영(함|했)?$|갱신|업데이트/;
const isDeltaSummary = (s: string | undefined) => !!s && DELTA_RE.test(s.trim());

/** First "> …" line under the title (the page's own one-line summary), without citations. */
function leadSummary(body: string): string {
  const q = body.match(/^>\s*(.+)$/m)?.[1] ?? "";
  const t = q.replace(CITATION_RE, "").replace(/\s+/g, " ").trim();
  return t.length > 70 ? t.slice(0, 68) + "…" : t;
}

/** Summary to store for a page: the writer's summary unless it is a delta note, else previous, else the lead line. */
export function pageSummary(next: string | undefined, prev: string | undefined, body: string): string {
  if (next && next.trim() && !isDeltaSummary(next)) return next.trim();
  if (prev && prev.trim() && !isDeltaSummary(prev)) return prev.trim();
  return leadSummary(body) || (next ?? "").trim();
}
