// Verifies fixture PDFs: page counts + extractable text sample (unpdf). Run from pocs/: node fixtures/tests/check-pdfs.mjs
import { readFileSync, existsSync } from "node:fs";
import { getDocumentProxy, extractText } from "unpdf";
for (const f of ["fixtures/presentation.pdf", "fixtures/proposal.pdf"]) {
  if (!existsSync(f)) { console.log(f, "MISSING"); continue; }
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(f)));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const all = text.join("\n");
  const page1 = await pdf.getPage(1); const vp = page1.getViewport({ scale: 1 });
  console.log(`${f}: ${totalPages} pages, page size ${vp.width.toFixed(0)}x${vp.height.toFixed(0)}pt, ${all.length} chars extracted, min/page ${Math.min(...text.map((t) => t.length))}`);
  console.log("  p1:", text[0].replace(/\s+/g, " ").slice(0, 160));
  console.log("  p" + Math.ceil(totalPages / 2) + ":", text[Math.ceil(totalPages / 2) - 1].replace(/\s+/g, " ").slice(0, 160));
  for (const kw of ["118원", "142원", "340억", "210억", "32억"]) { const pages = text.map((t, i) => (t.includes(kw) ? i + 1 : 0)).filter(Boolean); if (pages.length) console.log(`  "${kw}" on pages ${pages.join(",")}`); }
}
