// Review helper (review:slide): generates edge-case PDFs into .verify/slide/review/.
// - mixed.pdf: page 1 landscape 960x540, page 2 portrait A4, page 3 landscape (mixed sizes)
// - encrypted.pdf: has an /Encrypt dict with a non-empty user password → pdf.js PasswordException
// - single.pdf: 1 page
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = ".verify/slide/review";
mkdirSync(OUT, { recursive: true });

function build(pages, { encrypt = false } = {}) {
  const objs = [];
  const add = (s) => (objs.push(s), objs.length);
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  pages.forEach(([w, h], i) => {
    const text = `BT /F1 ${Math.round(Math.min(w, h) / 6)} Tf 40 ${Math.round(h / 2)} Td (PAGE ${i + 1} ${w}x${h}) Tj ET 0 0 1 RG 8 w 4 4 ${w - 8} ${h - 8} re S`;
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let enc = 0;
  if (encrypt) {
    const hex32 = "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";
    enc = add(`<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${hex32}> /P -44 >>`);
  }
  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${encrypt ? ` /Encrypt ${enc} 0 R /ID [<0123456789ABCDEF0123456789ABCDEF> <0123456789ABCDEF0123456789ABCDEF>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

writeFileSync(`${OUT}/mixed.pdf`, build([[960, 540], [595, 842], [960, 540]]));
writeFileSync(`${OUT}/encrypted.pdf`, build([[960, 540]], { encrypt: true }));
writeFileSync(`${OUT}/single.pdf`, build([[960, 540]]));
console.log("ok");
