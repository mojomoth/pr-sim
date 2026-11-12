// Validates fixtures/sample-session.json against the SessionRecord zod schema (fixtures/lib/session.ts, kept in sync with lib/types.ts by tsc).
// Run from pocs/: node fixtures/tests/check-session.mjs
import { readFileSync } from "node:fs";
import { SessionRecordSchema } from "../lib/session.ts";
const s = SessionRecordSchema.parse(JSON.parse(readFileSync("fixtures/sample-session.json", "utf8")));
const ts = s.transcript.map((x) => x.t);
if (ts.some((t, i) => i && t <= ts[i - 1])) throw new Error("transcript t not increasing");
if (ts.at(-1) > s.presentationMinutes * 60) throw new Error("transcript exceeds presentation time");
const temps = new Set(s.judges.map((j) => j.temperament));
if (temps.size !== 3) throw new Error("expected 3 temperaments");
for (const q of s.qa) if (!s.judges.some((j) => j.id === q.judge.id)) throw new Error("qa judge not in judges: " + q.judge.id);
console.log(`OK SessionRecord: ${s.transcript.length} sentences (0–${ts.at(-1)}s of ${s.presentationMinutes * 60}s), judges ${s.judges.map((j) => `${j.name}/${j.temperament}`).join(", ")}, ${s.qa.length} QA`);
