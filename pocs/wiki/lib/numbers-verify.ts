// Deterministic check of the LLM-built key-numbers table against the immutable raw pages.
// Pure (no fs) so it can be unit-tested and re-run on existing wikis.
//
// For each row we take the figures in its value ("210억", "142원", "14.3%", "14명") and look them up in
// every cited raw page (whitespace/comma-insensitive):
//   - page contains the figure                     → supported, kept
//   - page mentions the metric with a DIFFERENT figure of the same unit nearby
//                                                  → kept, row marked conflict, note gets "p.N: <other value>"
//   - otherwise (page doesn't state this value)     → citation dropped (moved to `unverified`)
// Rows whose value has no checkable figure are left untouched.

import type { KeyNumber } from "./types";

const UNIT = "(?:조|억|천만|백만|만|천)?\\s?(?:원|%|명|개월|개사|개|곳|톤|세트|배|건|회|평|㎡|kg|t)";
const FIG_RE = new RegExp(`\\d[\\d,.]*\\s?(?:조|억|천만|백만|만|천)(?:\\s?원)?|\\d[\\d,.]*\\s?${UNIT}`, "g");

// "6,800 억" → "6800억", "18.0만" → "18만"
const norm = (s: string) =>
  s
    .normalize("NFC")
    .replace(/[\s,]/g, "")
    .replace(/(\d)\.0+(?!\d)/g, "$1");

/** "210억 원" → "210억", "142원" → "142원", "약 14.3%" → "14.3%". Magnitude figures drop a trailing 원. */
export function figuresOf(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.normalize("NFC").matchAll(FIG_RE)) {
    let t = norm(m[0]).replace(/\.$/, "");
    if (/[조억만천]원$/.test(t)) t = t.slice(0, -1);
    if (t.replace(/\D/g, "").length >= 1) out.add(t);
  }
  return [...out];
}

const unitOf = (fig: string) => fig.replace(/^[\d.]+/, "");

/** Search key for a metric name: the whole name without spaces/parentheses. (First-word keys such as
 *  "웨이브셀" matched unrelated rows and produced false conflicts, so only the full name is used.) */
function metricKeys(metric: string): string[] {
  const k = norm(metric.replace(/\([^)]*\)/g, " "));
  return k.length >= 2 ? [k] : [];
}

/** A differing figure stated right after the metric name on this page (same unit as the row's value). */
function otherValueNear(pageNorm: string, keys: string[], figs: string[], stopKeys: string[]): string | null {
  const units = new Set(figs.map(unitOf));
  for (const k of keys) {
    let from = 0;
    for (let n = 0; n < 6; n++) {
      const i = pageNorm.indexOf(k, from);
      if (i < 0) break;
      from = i + k.length;
      let win = pageNorm.slice(from, from + 30);
      // the window ends where another metric starts ("SAM 6,800억 SOM 210억" must not give SAM=210억)
      for (const sk of stopKeys) {
        const j = win.indexOf(sk);
        if (j >= 0) win = win.slice(0, j);
      }
      // only the figure closest to the metric name counts
      const m = win.match(FIG_RE)?.[0];
      if (!m) continue;
      let t = m.replace(/\.$/, "");
      if (/[조억만천]원$/.test(t)) t = t.slice(0, -1);
      if (units.has(unitOf(t)) && !figs.includes(t)) return t;
    }
  }
  return null;
}

export interface VerifyStats {
  rowsChecked: number;
  droppedCitations: number;
  newConflicts: number;
}

export function verifyKeyNumbers(rows: KeyNumber[], rawPages: string[]): { rows: KeyNumber[]; stats: VerifyStats } {
  const pagesNorm = rawPages.map((t) => norm(t ?? ""));
  const stats: VerifyStats = { rowsChecked: 0, droppedCitations: 0, newConflicts: 0 };
  const keysByRow = rows.map((r) => metricKeys(r.metric));
  const out = rows.map((r, ri) => {
    const figs = figuresOf(r.value);
    if (!figs.length || !r.pages.length) return r;
    stats.rowsChecked++;
    const keys = keysByRow[ri];
    const related = (k: string) => keys.some((o) => o.includes(k) || k.includes(o));
    const stopKeys = [...new Set(keysByRow.flat())].filter((k) => !related(k));
    const keep: number[] = [];
    const unverified = new Set(r.unverified ?? []);
    const others: string[] = [];
    let supported = 0;
    for (const p of r.pages) {
      const t = pagesNorm[p - 1];
      if (t == null) continue;
      if (figs.some((f) => t.includes(f))) {
        keep.push(p);
        supported++;
        continue;
      }
      // conflict detection only for single-figure values ("142원"), not composite ones ("45%(9억), 25%(5억)…")
      const other = figs.length <= 2 ? otherValueNear(t, keys, figs, stopKeys) : null;
      if (other) {
        keep.push(p);
        others.push(`p.${p}에는 ${other}`);
      } else unverified.add(p);
    }
    // never drop every citation: if nothing on the cited pages states the value, keep the LLM's pages (and say so)
    if (!supported && !others.length) return { ...r, unverified: [...unverified].sort((a, b) => a - b) };
    stats.droppedCitations += r.pages.length - keep.length;
    let note = r.note;
    let conflict = r.conflict;
    const fresh = others.filter((o) => !note.includes(o));
    if (fresh.length) {
      note = `${note ? note + " · " : ""}[원문 대조] ${fresh.join(", ")}`;
      if (!conflict) stats.newConflicts++;
      conflict = true;
    }
    return { ...r, pages: keep, note, conflict, unverified: [...unverified].filter((p) => !keep.includes(p)).sort((a, b) => a - b) };
  });
  return { rows: out, stats };
}
