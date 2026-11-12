import { readRawPage } from "@/wiki/lib";
import { jsonError } from "@/wiki/lib/http";
import { isDocId } from "@/wiki/lib/store";

// GET /api/wiki/docs/{docId}/raw/{page} → text/plain (immutable extracted text of that PDF page)
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string; page: string }> }) {
  const { docId, page } = await params;
  if (!isDocId(docId) || !/^\d{1,4}$/.test(page)) return jsonError(400, "invalid params");
  const text = await readRawPage(docId, Number(page));
  if (text == null) return jsonError(404, "page not found");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, max-age=3600, immutable" } });
}
