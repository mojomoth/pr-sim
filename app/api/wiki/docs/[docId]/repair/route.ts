import { repairWiki } from "@/wiki/lib";
import { docParam, errorResponse } from "@/wiki/lib/http";

// POST /api/wiki/docs/{docId}/repair → deterministic maintenance (no LLM): re-ground figure citations in the raw
// pages, restore index summaries that were edit notes, re-verify 주요-수치, rebuild index.md.
export async function POST(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  try {
    return Response.json(await repairWiki(docId), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
