// Wait until a wiki doc is ready/error and print a status summary. node wiki/scripts/wait-status.mjs <docId> [timeoutSec]
const [docId, tSec = "900"] = process.argv.slice(2);
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const end = Date.now() + Number(tSec) * 1000;
let d;
while (Date.now() < end) {
  d = await (await fetch(`${BASE}/api/wiki/docs/${docId}`)).json();
  if (["ready", "error"].includes(d.status?.state)) break;
  await new Promise((r) => setTimeout(r, 2000));
}
const s = d.status;
console.log(s.state, s.error ?? "", JSON.stringify(s.timings), s.provider);
for (const [k, u] of Object.entries(s.usage)) console.log(" ", k, `calls=${u.calls} in=${u.inputTokens} out=${u.outputTokens} avgMs=${Math.round(u.ms / u.calls)}`);
for (const e of s.events) console.log(" -", e.phase, e.msg);
console.log("pages", s.wikiPages, "created", s.pagesCreated, "updated", s.pagesUpdated, "keyNumbers", d.keyNumbers.length, "conflicts", d.keyNumbers.filter((k) => k.conflict).length);
