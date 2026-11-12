// pdf → page texts (same shape the browser sends), for API-level checks.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const pdfjs = await import("../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const [, , src, out] = process.argv;
const bytes = readFileSync(src);
const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
const pageTexts = [];
for (let i = 1; i <= doc.numPages; i++) {
  const c = await (await doc.getPage(i)).getTextContent();
  pageTexts.push(c.items.map((x) => x.str + (x.hasEOL ? "\n" : "")).join(""));
}
writeFileSync(out, JSON.stringify({ docId: createHash("sha256").update(bytes).digest("hex").slice(0, 16), pageTexts }));
console.log(doc.numPages, "pages", pageTexts.reduce((a, t) => a + t.length, 0), "chars");
