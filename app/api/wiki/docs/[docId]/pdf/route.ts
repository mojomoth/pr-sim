import { readFile } from "node:fs/promises";
import path from "node:path";
import { docParam, jsonError } from "@/wiki/lib/http";
import { rawDir } from "@/wiki/lib/store";

// GET /api/wiki/docs/{docId}/pdf → original PDF (append #page=N in the browser to jump)
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  try {
    const buf = await readFile(path.join(rawDir(docId), "source.pdf"));
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=3600, immutable" } });
  } catch {
    return jsonError(404, "pdf not found");
  }
}
