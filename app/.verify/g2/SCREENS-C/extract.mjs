// Node: page texts + docId for the sample PDFs (same as the app's readPdf: pdf.js page text, sha256 first 16 hex).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const pdfjs = await import("/Users/jyl/work/study/pr-sim/app/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const out = {};
for (const role of ["presentation", "proposal"]) {
  const file = `/Users/jyl/work/study/pr-sim/app/public/samples/${role}.pdf`;
  const buf = readFileSync(file);
  const docId = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const pageTexts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pageTexts.push(tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("").replace(/[ \t]+/g, " ").trim());
  }
  out[role] = { docId, filename: `${role}.pdf`, bytes: buf.length, pageCount: doc.numPages, pageTexts };
  console.log(role, docId, doc.numPages, pageTexts.join("").length);
}
writeFileSync(new URL("./docs.json", import.meta.url), JSON.stringify(out));
