import { readFile } from "node:fs/promises";
import { getDocumentProxy, extractText } from "unpdf";
for (const f of ["fixtures/presentation.pdf", "fixtures/proposal.pdf"]) {
  const buf = new Uint8Array(await readFile(f));
  const pdf = await getDocumentProxy(buf);
  const sizes = new Set();
  for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); const v = p.getViewport({ scale: 1 }); sizes.add(`${Math.round(v.width)}x${Math.round(v.height)}`); }
  const { text } = await extractText(pdf, { mergePages: false });
  const lens = text.map(t => t.length);
  console.log(f, "pages", pdf.numPages, "sizes", [...sizes], "chars", lens.reduce((a,b)=>a+b,0), "min", Math.min(...lens));
  const hangul = text.join("").match(/[가-힣]/g)?.length;
  console.log(" hangul chars", hangul);
  if (f.includes("presentation")) text.forEach((t,i)=>console.log(` p${i+1}:`, t.replace(/\s+/g," ").slice(0,220)));
  else { console.log(" p1:", text[0].replace(/\s+/g," ").slice(0,300)); console.log(" p34:", text[33].replace(/\s+/g," ").slice(0,600)); console.log(" p2:", text[1].replace(/\s+/g," ").slice(0,600));
    for (const k of ["118원","142원","340억","210억","32억","25만","28%","14%"]) console.log(" ",k, text.map((t,i)=>t.includes(k)?i+1:0).filter(Boolean).join(","));
    // check for chapter headings
    const all = text.join("\n");
    for (const k of ["요약","회사 소개","문제 정의","솔루션","시장 분석","세일즈","경쟁 분석","운영","원가 구조","재무 계획","리스크","팀","일정","부록"]) console.log("  ch", k, all.includes(k));
  }
}
