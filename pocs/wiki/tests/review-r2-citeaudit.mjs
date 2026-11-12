// Reviewer r2: deterministic audit of ALL wiki page lines — for each line with (p.N) citations and figures like 25만/142원/83%,
// check that at least one cited raw page contains each figure.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const doc = process.argv[2];
const root = `.data/wiki/${doc}`;
const meta = JSON.parse(readFileSync(`${root}/raw/meta.json`, "utf8"));
const raw = Array.from({ length: meta.pageCount }, (_, i) => readFileSync(`${root}/raw/pages/${String(i + 1).padStart(3, "0")}.txt`, "utf8").replace(/[\s,]/g, ""));
const CIT = /\(\s*p{1,2}\.\s*\d+(?:\s*[–\-~,]\s*(?:p{1,2}\.\s*)?\d+)*\s*\)/g;
const pagesOf = (s) => { const out = []; for (const part of s.replace(/[()]/g, "").replace(/p{1,2}\.\s*/g, "").split(",")) { const r = part.split(/[–\-~]/).map((x) => +x.trim()); if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] <= 30) for (let p = r[0]; p <= r[1]; p++) out.push(p); else if (Number.isFinite(r[0])) out.push(r[0]); } return out; };
const FIG = /\d[\d,.]*\s?(?:억|만|원|%|곳|명|톤|개|건|세트)/g;
let lines = 0, figs = 0, okc = 0; const bad = [];
for (const f of readdirSync(`${root}/wiki`)) {
  if (!f.endsWith(".md") || ["log.md", "index.md", "SCHEMA.md"].includes(f)) continue;
  const body = readFileSync(`${root}/wiki/${f}`, "utf8").replace(/^---[\s\S]*?---\n/, "");
  for (const line of body.split("\n")) {
    const cites = [...line.matchAll(CIT)];
    if (!cites.length) continue;
    // per segment: text before each citation group
    let last = 0;
    for (const c of cites) {
      const seg = line.slice(last, c.index); last = c.index + c[0].length;
      const pages = pagesOf(c[0]).filter((p) => p >= 1 && p <= meta.pageCount);
      const fs = [...new Set([...seg.matchAll(FIG)].map((m) => m[0].replace(/[\s,]/g, "")))].filter((t) => t.replace(/\D/g, "").length >= 2);
      if (!fs.length || !pages.length) continue;
      lines++;
      for (const t of fs) { figs++; if (pages.some((p) => raw[p - 1].includes(t))) okc++; else if (raw.some((r) => r.includes(t))) bad.push({ f, t, pages, seg: seg.trim().slice(-90), actual: raw.map((r, i) => (r.includes(t) ? i + 1 : 0)).filter(Boolean).slice(0, 6) }); else bad.push({ f, t, pages, seg: seg.trim().slice(-90), actual: "NOT IN DOC (derived/computed?)" }); }
    }
  }
}
console.log(`${doc}: segments ${lines}, figures ${figs}, grounded in cited page ${okc} (${(100 * okc / figs).toFixed(1)}%), ungrounded ${bad.length}`);
for (const b of bad.slice(0, 25)) console.log(` - ${b.f} "${b.t}" cited p.${b.pages.slice(0, 8).join(",")} actual ${JSON.stringify(b.actual)} :: …${b.seg}`);
writeFileSync(`.verify/wiki/review/r2-citeaudit-${doc}.json`, JSON.stringify({ figs, okc, bad }, null, 1));
