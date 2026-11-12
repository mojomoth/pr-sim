// One LintIssueIn: /api/questions `lint` and /api/report `session.lint` validate with the same schema object.
import { createJiti } from "../../../node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../../../src", import.meta.url).pathname, "server-only": new URL("../../../node_modules/.pnpm/server-only@0.0.1/node_modules/server-only/empty.js", import.meta.url).pathname } });
const w = await jiti.import("../../../src/server/wiki/schema.ts");
const q = await jiti.import("../../../src/server/question/schema.ts");
const r = await jiti.import("../../../src/server/report/schema.ts");
const qEl = q.GenerateIn.shape.lint.unwrap().element;
const rEl = r.ReportIn.shape.session.shape.lint.unwrap().element;
const issue = { type: "cross-doc-mismatch", severity: "high", message: "가".repeat(6000), pages: ["원가-구조"], citations: [12], otherCitations: [4] };
console.log(JSON.stringify({ questionsUsesShared: qEl === w.LintIssueIn, reportUsesShared: rEl === w.LintIssueIn, longMessageAcceptedByBoth: qEl.safeParse(issue).success && rEl.safeParse(issue).success }, null, 2));
