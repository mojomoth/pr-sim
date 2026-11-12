// node wiki/tests/lint.mjs <docId> [againstDocId]  — runs LINT via API and prints issues
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const [doc, against] = process.argv.slice(2);
const t0 = Date.now();
const r = await (await fetch(`${BASE}/api/wiki/docs/${doc}/lint`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ against }) })).json();
if (r.error) throw new Error(r.error);
console.log(`lint ${doc}${against ? ` vs ${against}` : ""}: ${r.issues.length} issues in ${Date.now() - t0}ms`);
for (const i of r.issues) console.log(` [${i.severity}] ${i.type}: ${i.message.slice(0, 200)} | p.${i.citations.join(",")}${i.otherCitations?.length ? ` | other p.${i.otherCitations.join(",")}` : ""}`);
