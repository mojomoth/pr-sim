// Citation audit over stored PoC wikis: for every "(p.N…)" group, each checkable figure in the closing segment
// counts as supported when a cited raw page contains it. Same measuring stick (current checkableFigures) for all columns.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CITATION_RE, parseCitationGroup, parseFrontmatter } from "@/server/wiki/markdown";
import { checkableFigures, normRaw, regroundCitations } from "@/server/wiki/reground";

const variant = process.argv[2] ?? "new";
const before = variant === "old" ? await import("@/server/wiki/__before") : null;
const ROOT = process.argv[3];
function audit(body: string, rawNorm: string[], misses: unknown[], slug: string) {
  let total = 0, ok = 0;
  for (const line of body.split("\n")) {
    let last = 0;
    for (const m of line.matchAll(CITATION_RE)) {
      const seg = line.slice(last, m.index);
      last = m.index! + m[0].length;
      const cited = parseCitationGroup(m[0]);
      for (const f of checkableFigures(seg)) {
        if (!rawNorm.some((t) => t.includes(f))) continue; // derived value, not in source at all
        total++;
        if (cited.some((p) => rawNorm[p - 1]?.includes(f))) ok++;
        else misses.push([slug, f, cited, seg.trim().slice(0, 80)]);
      }
    }
  }
  return { total, ok };
}
const out: Record<string, unknown> = {};
for (const id of readdirSync(ROOT)) {
  const dir = join(ROOT, id);
  if (!existsSync(join(dir, "raw/pages"))) continue;
  const raw = readdirSync(join(dir, "raw/pages")).sort().map((f) => readFileSync(join(dir, "raw/pages", f), "utf8"));
  const rawNorm = raw.map(normRaw);
  const res = { stored: { total: 0, ok: 0 }, regrounded: { total: 0, ok: 0 }, misses: [] as unknown[] };
  for (const f of readdirSync(join(dir, "wiki"))) {
    const { fm, body } = parseFrontmatter(readFileSync(join(dir, "wiki", f), "utf8"));
    if (fm.type === "numbers" || fm.type === "meta" || /^(index|log|log-queries|SCHEMA)\.md$/.test(f)) continue;
    const a = audit(body, rawNorm, [], f);
    res.stored.total += a.total; res.stored.ok += a.ok;
    const rg = (before ?? { regroundCitations }).regroundCitations(body, raw).body;
    const b = audit(rg, rawNorm, res.misses, f);
    res.regrounded.total += b.total; res.regrounded.ok += b.ok;
  }
  out[id] = res;
}
console.log(JSON.stringify({ variant, out }, null, 1));
