// Fetch every served JS/HTML/worklet on the deployed URL and count occurrences of the provider key values (counts only).
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "https://pr-sim-lake.vercel.app";
const env = Object.fromEntries(readFileSync("/Users/jyl/work/study/pr-sim/.env", "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const keys = Object.entries(env).filter(([, v]) => v.length >= 12);
const pages = ["/", "/setup", "/present", "/qa", "/result", "/history", "/setup?s=x", "/result?s=x&tab=feedback"];
const urls = new Set(pages.map((p) => BASE + p));
const seen = new Map();
const queue = [...urls];
while (queue.length) {
  const u = queue.shift();
  if (seen.has(u)) continue;
  const r = await fetch(u); const t = await r.text(); seen.set(u, t);
  for (const m of t.matchAll(/["'(](\/_next\/static\/[^"')\s\\]+\.(?:js|css))/g)) { const n = BASE + m[1]; if (!seen.has(n)) queue.push(n); }
  for (const m of t.matchAll(/static\/chunks\/[A-Za-z0-9_.\-\/]+\.js/g)) { const n = `${BASE}/_next/${m[0]}`; if (!seen.has(n)) queue.push(n); }
}
for (const extra of ["/worklets/pcm16k-worklet.js", "/pcm16k-worklet.js", "/pdfjs/pdf.worker.min.mjs"]) { const r = await fetch(BASE + extra); if (r.ok) seen.set(BASE + extra, await r.text()); }
const counts = {}; let bytes = 0;
for (const [k, v] of keys) counts[k] = 0;
const patterns = { "sk-proj-/sk-": /sk-(proj-)?[A-Za-z0-9_\-]{20,}/g, "AIza": /AIza[0-9A-Za-z_\-]{30,}/g, "sk-ant-": /sk-ant-[A-Za-z0-9_\-]{20,}/g, "process.env.*_API_KEY": /(OPENAI|GOOGLE|CLAUDE|ANTHROPIC)_API_KEY/g };
const pat = Object.fromEntries(Object.keys(patterns).map((k) => [k, 0]));
for (const [u, t] of seen) { bytes += t.length; for (const [k, v] of keys) counts[k] += t.split(v).length - 1; for (const [k, re] of Object.entries(patterns)) pat[k] += (t.match(re) ?? []).length; }
const out = { base: BASE, filesScanned: seen.size, jsFiles: [...seen.keys()].filter((u) => /\.m?js$/.test(u)).length, bytes, keyValueOccurrences: counts, patternMatches: pat };
writeFileSync(new URL("./keyscan.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
