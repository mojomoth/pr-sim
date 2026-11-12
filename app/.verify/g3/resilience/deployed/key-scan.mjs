// Counts occurrences of every .env value (len >= 12) in the deployed HTML + served JS/CSS. Prints COUNTS ONLY, never values.
// Run: node key-scan.mjs > key-scan.txt
import { readFileSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "https://pr-sim-lake.vercel.app";
const env = Object.fromEntries(readFileSync("/Users/jyl/work/study/pr-sim/.env", "utf8").split("\n").map((l) => l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const secrets = Object.entries(env).filter(([, v]) => v.length >= 12);
const routes = ["/", "/setup", "/present", "/qa", "/result", "/history", "/_not-found"];
const assets = new Set(), bodies = new Map();
for (const r of routes) {
  const html = await (await fetch(BASE + r)).text();
  bodies.set("html:" + r, html);
  for (const m of html.matchAll(/["'(](\/_next\/static\/[^"')\s]+?\.(?:js|css))/g)) assets.add(m[1]);
}
// chunks referenced from chunks (lazy imports)
const queue = [...assets];
while (queue.length) {
  const a = queue.shift();
  const t = await (await fetch(BASE + a)).text();
  bodies.set(a, t);
  for (const m of t.matchAll(/static\/chunks\/[A-Za-z0-9_\-.~]+\.js/g)) { const p = "/_next/" + m[0]; if (!assets.has(p)) { assets.add(p); queue.push(p); } }
}
let totalBytes = 0; for (const b of bodies.values()) totalBytes += b.length;
console.log(`base ${BASE} · ${routes.length} routes · ${bodies.size - routes.length} static assets · ${totalBytes} bytes scanned`);
console.log(`env entries with value length >= 12: ${secrets.length}`);
let sum = 0;
for (const [k, v] of secrets) { let n = 0; for (const b of bodies.values()) n += b.split(v).length - 1; sum += n; console.log(`${k}: value occurrences = ${n}; name occurrences = ${[...bodies.values()].reduce((s, b) => s + b.split(k).length - 1, 0)}`); }
const pat = { "sk-proj-/sk-ant-/sk- style": /sk-(?:proj|ant|svcacct)?-?[A-Za-z0-9_-]{20,}/g, "AIza google key": /AIza[0-9A-Za-z_-]{30,}/g };
for (const [n, re] of Object.entries(pat)) console.log(`${n} pattern matches: ${[...bodies.values()].reduce((s, b) => s + (b.match(re)?.length ?? 0), 0)}`);
console.log(`TOTAL key value occurrences: ${sum}`);
