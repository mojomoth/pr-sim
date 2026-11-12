// Run a report through the HTTP API (real LLM calls) and save it.
//   node report/tests/run-report.mjs <ref> <outName> [--force]
//   e.g. node report/tests/run-report.mjs fixture:sample sample --force
import { writeFileSync, mkdirSync } from "node:fs";
const [ref, out = ref.replace(/\W+/g, "-")] = process.argv.slice(2);
const force = process.argv.includes("--force");
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const t0 = Date.now();
const res = await fetch(`${BASE}/api/report/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref, force }) });
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const dec = new TextDecoder();
let buf = "";
let report = null;
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
    if (e.type === "step") console.log(`${s}s  ${e.step.status.padEnd(8)} ${e.step.label}${e.step.ms ? ` (${(e.step.ms / 1000).toFixed(1)}s)` : ""}${e.step.detail ? ` — ${e.step.detail}` : ""}`);
    else if (e.type === "done") report = e.report;
    else if (e.type === "error") throw new Error(e.error);
    else if (e.type === "cached") console.log(`${s}s  cached ${e.key}`);
  }
}
mkdirSync("report/samples", { recursive: true });
writeFileSync(`report/samples/report-${out}.json`, JSON.stringify(report, null, 1));
const o = report.overall;
console.log(`\n${out}: total ${o.total} | 발표력 ${o.sub.delivery} 논리성 ${o.sub.logic} 대응력 ${o.sub.response} 자료 ${o.sub.materials} | ${report.meta.provider} | ${(report.meta.ms / 1000).toFixed(1)}s | calls ${report.meta.usage.calls} in ${report.meta.usage.inputTokens} out ${report.meta.usage.outputTokens}`);
console.log(`QA: ${report.qa.map((q) => `${q.score}/${q.verdict}`).join(", ")} | docs: ${report.materials.docs.map((d) => `${d.role} ${d.score}`).join(", ")} | mismatch ${report.materials.consistency.filter((r) => r.status === "mismatch").length}`);
console.log(`headline: ${o.headline} / ${o.oneLiner}`);
if (report.meta.warnings.length) console.log("warnings:", report.meta.warnings);
