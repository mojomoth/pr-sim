import "server-only";
import { open, stat } from "node:fs/promises";
import path from "node:path";

/** Sample PDFs served at /api/slide/sample/[name] (from pocs/fixtures). */
export const SAMPLES = {
  presentation: { file: "presentation.pdf", title: "샘플 발표자료", desc: "16:9 피치덱 · 12장" },
  proposal: { file: "proposal.pdf", title: "샘플 제안자료", desc: "A4 사업계획서 · 58쪽" },
} as const;
export type SampleName = keyof typeof SAMPLES;

export function isSampleName(n: string): n is SampleName {
  return Object.hasOwn(SAMPLES, n);
}

/**
 * Serve a sample PDF with HTTP Range support so pdf.js can fetch the first page
 * of a long document without downloading the whole file first.
 */
export async function serveSample(name: SampleName, req: Request): Promise<Response> {
  const file = path.join(process.cwd(), "fixtures", SAMPLES[name].file);
  const { size, mtimeMs } = await stat(file);
  const etag = `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
  const base = {
    "content-type": "application/pdf",
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
    etag,
    "content-disposition": `inline; filename="${SAMPLES[name].file}"`,
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    if (range[1] === "" && range[2] !== "") start = Math.max(0, size - Number(range[2]));
    else {
      start = Number(range[1] || 0);
      if (range[2] !== "") end = Math.min(size - 1, Number(range[2]));
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
    }
    status = 206;
  }
  const length = end - start + 1;
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    const headers: Record<string, string> = { ...base, "content-length": String(length) };
    if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    return new Response(req.method === "HEAD" ? null : new Uint8Array(buf), { status, headers });
  } finally {
    await fh.close();
  }
}
