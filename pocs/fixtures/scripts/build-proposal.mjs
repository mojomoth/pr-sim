// Assembles fixtures/src/proposal/chNN.html into fixtures/src/proposal.html and prints fixtures/proposal.pdf (A4).
// Run from pocs/:  node fixtures/scripts/build-proposal.mjs
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CHROME } from "../../scripts/browser.mjs";
import { CHAPTERS } from "./chapters.mjs";
import { getDocumentProxy, extractText } from "unpdf";

const ROOT = join(process.cwd(), "fixtures");
const ACC = "#1F7A5C";
const chapters = CHAPTERS.map((c) => {
  const f = join(ROOT, "src", "proposal", `${c.id}.html`);
  if (!existsSync(f)) throw new Error(`missing ${f} — run gen-proposal-text.mjs first`);
  return { ...c, html: readFileSync(f, "utf8").replace(/<\/?(html|head|body|style|script)[^>]*>/gi, "") };
});
// Guard: generator meta-references (the prompt's "[팩트 시트]") must never reach the reader.
const META = /팩트\s*시트|fact\s*sheet|프롬프트/i;
for (const c of chapters) {
  const m = META.exec(c.html);
  if (m) throw new Error(`${c.id}: generator meta-reference "${m[0]}" leaked into the text: …${c.html.slice(Math.max(0, m.index - 60), m.index + 40)}…`);
}

const css = `
@page { size: A4; margin: 22mm 18mm 20mm 18mm }
* { box-sizing: border-box }
body { font-family: "Pretendard", "Apple SD Gothic Neo", sans-serif; font-size: 9.6pt; line-height: 1.62; color: #1a1a1a; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; word-break: keep-all }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always }
.cover .top { font-size: 11pt; font-weight: 700; color: ${ACC} }
.cover h1 { font-size: 34pt; line-height: 1.25; margin: 0 0 8mm; letter-spacing: -0.02em }
.cover .sub { font-size: 14pt; color: #555 }
.cover table { width: 100%; font-size: 10.5pt; border-collapse: collapse }
.cover td { padding: 2.5mm 0; border-bottom: 1px solid #ddd }
.toc { page-break-after: always }
.toc h2 { border: 0 }
.toc ol { font-size: 12pt; line-height: 2.2; padding-left: 0; list-style: none }
.toc li { display: flex; align-items: baseline; gap: 2mm; margin: 0 }
.toc .n { width: 8mm; color: #777 }
.toc .dots { flex: 1; border-bottom: 1px dotted #aaa; transform: translateY(-1.2mm) }
.toc .pg { min-width: 8mm; text-align: right; font-weight: 600 }
.ch { page-break-before: always }
h2 { font-size: 20pt; margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 2px solid #111; letter-spacing: -0.01em }
h3 { font-size: 12.5pt; margin: 6mm 0 2.5mm; color: #111 }
h3::before { content: ""; display: inline-block; width: 3mm; height: 3mm; background: ${ACC}; margin-right: 2.5mm; vertical-align: 1px }
p { margin: 0 0 2.6mm; text-align: justify }
ul, ol { margin: 0 0 3.2mm; padding-left: 6mm } li { margin-bottom: 1mm }
table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 9.3pt; line-height: 1.5; page-break-inside: auto }
tr { page-break-inside: avoid }
th { background: #F0F0F0; font-weight: 700; text-align: left; padding: 2mm 2.4mm; border-top: 1.5px solid #111; border-bottom: 1px solid #bbb }
td { padding: 1.8mm 2.4mm; border-bottom: 1px solid #E2E2E2; vertical-align: top }
blockquote { margin: 3mm 0; padding: 2mm 5mm; border-left: 3px solid ${ACC}; background: #F5F8F7; color: #333 }
strong { font-weight: 700 }
`;

const buildHtml = (pages) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>리웨이브 사업계획서</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"/>
<style>${css}</style></head><body>
<section class="cover">
  <div class="top">사업계획서 · Pre-A 투자 심사 제출용 · 2026년 11월</div>
  <div><div class="sub">해조류 부산물 기반 생분해 완충재</div><h1>웨이브셀(WaveCell)<br/>사업계획서</h1><div class="sub">바다에서 온 완충재, 흙으로 돌아갑니다.</div></div>
  <table><tbody>
    <tr><td>회사명</td><td>주식회사 리웨이브 (ReWave Inc.)</td></tr>
    <tr><td>대표자</td><td>김서연</td></tr>
    <tr><td>소재지</td><td>본사 서울특별시 성동구 성수동 · 생산 전라남도 완도군</td></tr>
    <tr><td>투자 요청</td><td>Pre-A 20억 원 (투자 전 기업가치 120억 원)</td></tr>
    <tr><td>문서 구분</td><td>대외비 — 투자 심사 목적 외 사용 금지</td></tr>
  </tbody></table>
</section>
<section class="toc"><h2>목차</h2><ol>${chapters.map((c, i) => `<li><span class="n">${i + 1}.</span><span>${c.title}</span><span class="dots"></span><span class="pg">${pages?.[i] ?? "00"}</span></li>`).join("")}</ol></section>
${chapters.map((c) => `<section class="ch" id="${c.id}">${c.html}</section>`).join("\n")}
</body></html>`;

// Two-pass render so the TOC can show real page numbers: pass 1 uses "00" placeholders (same width, the TOC stays one
// page so pagination does not move), then chapter start pages are read back from the PDF text and pass 2 prints them.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const pdfOptions = {
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="width:100%;font-size:7.5pt;color:#999;padding:0 18mm;display:flex;justify-content:space-between;font-family:'Apple SD Gothic Neo',sans-serif"><span>주식회사 리웨이브 사업계획서</span><span>대외비</span></div>`,
  footerTemplate: `<div style="width:100%;font-size:8pt;color:#777;text-align:center;font-family:'Apple SD Gothic Neo',sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
  margin: { top: "22mm", bottom: "20mm", left: "18mm", right: "18mm" },
};
async function render(pages) {
  const html = buildHtml(pages);
  writeFileSync(join(ROOT, "src", "proposal.html"), html);
  await page.goto("file://" + join(ROOT, "src", "proposal.html"), { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  return new Uint8Array(await page.pdf(pdfOptions));
}
async function chapterStartPages(buf) {
  const { text } = await extractText(await getDocumentProxy(buf.slice()), { mergePages: false });
  const norm = text.map((t) => t.replace(/\s+/g, ""));
  const starts = [];
  let from = 2; // 0-based: skip cover (p1) and TOC (p2)
  chapters.forEach((c, i) => {
    const head = `${i + 1}.${c.title}`.replace(/\s+/g, "");
    const idx = norm.findIndex((t, p) => p >= from && t.slice(0, 120).includes(head));
    if (idx < 0) throw new Error(`chapter heading not found in PDF: ${head}`);
    starts.push(idx + 1);
    from = idx + 1;
  });
  return { starts, total: text.length };
}
const draft = await chapterStartPages(await render(null));
const finalBuf = await render(draft.starts);
const check = await chapterStartPages(finalBuf);
if (check.total !== draft.total || check.starts.join() !== draft.starts.join()) throw new Error("pagination moved between passes");
writeFileSync(join(ROOT, "proposal.pdf"), finalBuf);
await browser.close();
console.log(`wrote fixtures/proposal.pdf (${check.total} pages; chapter starts ${check.starts.map((p, i) => `${i + 1}:p${p}`).join(" ")})`);
