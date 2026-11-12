import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFile, describePdfError, formatBytes, PDF_LIMITS, pdfDocId } from "@/features/slide/pdf";
import { MAX_DOC_PAGES } from "@/server/types";

const pdf = (body = "%PDF-1.7\n1 0 obj\n", name = "deck.pdf", type = "application/pdf") => new File([body], name, { type });

test("limits: 30MB and the same page cap as the server", () => {
  assert.equal(PDF_LIMITS.maxBytes, 30 * 1024 * 1024);
  assert.equal(PDF_LIMITS.maxPages, MAX_DOC_PAGES);
});

test("accepts a PDF by header, also with leading junk or a generic MIME type", async () => {
  assert.ok((await checkFile(pdf())).length > 0);
  assert.ok(await checkFile(pdf("garbage\n%PDF-1.4\n")));
  assert.ok(await checkFile(pdf(undefined, "deck.PDF", "application/octet-stream")));
});

test("rejects wrong type, empty, oversize and files without the %PDF- magic", async () => {
  await assert.rejects(checkFile(pdf(undefined, "deck.png", "image/png")), { name: "PdfError", message: /PDF 파일만/ });
  await assert.rejects(checkFile(pdf("", "empty.pdf")), { name: "PdfError", message: /빈 파일/ });
  await assert.rejects(checkFile(pdf("<html>not a pdf</html>")), { name: "PdfError", message: /다른 형식/ });
  await assert.rejects(checkFile(pdf("x".repeat(1100) + "%PDF-")), { name: "PdfError" }, "magic must be within the first 1024 bytes");
  const big = new File([new Uint8Array(PDF_LIMITS.maxBytes + 1)], "big.pdf", { type: "application/pdf" });
  await assert.rejects(checkFile(big), { name: "PdfError", message: /너무 커요\(30\.0MB\)/ });
});

test("pdf.js failures map to Korean messages", () => {
  assert.match(describePdfError({ name: "PasswordException" }), /암호/);
  assert.match(describePdfError({ name: "InvalidPDFException" }), /손상/);
  assert.match(describePdfError(new Error("x")), /다시 시도/);
});

test("formatBytes and docId", async () => {
  assert.equal(formatBytes(512), "512B");
  assert.equal(formatBytes(2048), "2KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0MB");
  const id = await pdfDocId(new TextEncoder().encode("%PDF-1.7"));
  assert.match(id, /^[a-f0-9]{16}$/);
  assert.equal(id, await pdfDocId(new TextEncoder().encode("%PDF-1.7")));
});
