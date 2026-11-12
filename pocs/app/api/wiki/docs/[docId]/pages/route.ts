import { listWikiPages } from "@/wiki/lib";
import { docParam, jsonError } from "@/wiki/lib/http";
import { readStatusFile } from "@/wiki/lib/store";

// GET /api/wiki/docs/{docId}/pages → WikiPageInfo[] (404 for an unknown docId; [] while not yet built)
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  if (!(await readStatusFile(docId))) return jsonError(404, "unknown docId");
  return Response.json(await listWikiPages(docId), { headers: { "Cache-Control": "no-store" } });
}
