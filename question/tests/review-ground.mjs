// Reviewer: independently verify evidence quotes in an NDJSON generate stream (or run JSON) against raw page text.
import fs from "node:fs";
const [file, presId, propId] = process.argv.slice(2);
const BASE = "http://localhost:3100";
const norm = (s) => s.normalize("NFKC").replace(/[\s​]+/g, "").replace(/[“”"'‘’]/g, "");
const cache = {};
async function page(doc, n) {
  const id = doc === "presentation" ? presId : propId;
  const k = `${id}/${n}`;
  if (!(k in cache)) { const r = await fetch(`${BASE}/api/wiki/docs/${id}/raw/${n}`); cache[k] = r.ok ? norm(await r.text()) : ""; }
  return cache[k];
}
const txt = fs.readFileSync(file, "utf8");
let qs = [];
let transcript = [];
if (file.endsWith(".ndjson")) qs = txt.trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "question").map((e) => e.question);
else { const j = JSON.parse(txt); qs = j.questions ?? j.run?.questions; transcript = j.input?.transcript ?? []; }
const tr = norm((process.env.TRANSCRIPT ? JSON.parse(fs.readFileSync(process.env.TRANSCRIPT, "utf8")) : transcript).map((s) => s.text).join(" "));
let ok = 0, bad = 0, wrongPage = 0;
for (const q of qs) for (const e of q.evidence) {
  const quote = norm(e.quote).replace(/^…|…$/g, "");
  const p = e.correctedPage ?? e.page;
  let found;
  if (e.doc === "transcript") found = tr.includes(quote);
  else found = p ? (await page(e.doc, p)).includes(quote) : false;
  if (!found && e.doc !== "transcript") {
    for (let i = 1; i <= 60; i++) { const t = await page(e.doc, i); if (!t) break; if (t.includes(quote)) { wrongPage++; console.log(`  page mismatch ${q.id} claimed p.${p} actual p.${i}`); break; } }
  }
  if (found) ok++; else { bad++; console.log(`  NOT FOUND ${q.id} ${e.doc} p.${p} verified=${e.verified}: ${e.quote.slice(0, 60)}`); }
}
console.log(JSON.stringify({ questions: qs.length, quotesOk: ok, quotesBad: bad, wrongPage }));
