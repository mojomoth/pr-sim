#!/usr/bin/env node
// Validate every saved session against the shared SessionRecord zod schema (what the report PoC loads).
import { readdirSync, readFileSync } from "node:fs";
import { SessionRecordSchema } from "../../fixtures/lib/session.ts";
const dir = ".data/question/sessions";
let ok = 0;
for (const f of readdirSync(dir).filter((n) => /^qs_[a-z0-9]+\.json$/.test(n))) {
  const r = SessionRecordSchema.safeParse(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
  if (r.success) ok++;
  console.log(r.success ? "OK " : "BAD", f, r.success ? `qa=${r.data.qa.length} judges=${r.data.judges.map((j) => j.name + "/" + j.temperament).join(",")} transcript=${r.data.transcript.length} docs=${r.data.presentationDocId}/${r.data.proposalDocId}` : JSON.stringify(r.error.issues).slice(0, 300));
}
console.log(`${ok} valid`);
