import { deleteDoc, getDocMeta, getKeyNumbers, getWikiStatus, reingest, reverifyKeyNumbers } from "@/wiki/lib";
import { docParam, errorResponse, jsonError } from "@/wiki/lib/http";

// GET /api/wiki/docs/{docId} → { meta, status, keyNumbers }
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  const [meta, status, keyNumbers] = await Promise.all([getDocMeta(docId), getWikiStatus(docId), getKeyNumbers(docId)]);
  if (!status) return jsonError(404, "unknown docId");
  return Response.json({ meta, status, keyNumbers }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/wiki/docs/{docId} { action: "reingest" }       → rebuild the wiki from the stored source PDF (202).
//   A ready wiki is rebuilt in staging and swapped in only on success (it stays readable/queryable meanwhile and is
//   kept on failure → status.lastReingestError). 503 (Korean message) when no AI provider is available — nothing is
//   started. `preflight: false` skips that check (tests of the failure path).
// POST /api/wiki/docs/{docId} { action: "verify-numbers" } → re-check 주요-수치 against raw pages (no LLM)
export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { action?: string; preflight?: unknown };
  if (b.action !== "reingest" && b.action !== "verify-numbers") return jsonError(400, 'action must be "reingest" or "verify-numbers"');
  try {
    if (b.action === "verify-numbers") return Response.json(await reverifyKeyNumbers(docId));
    return Response.json(await reingest(docId, { preflight: b.preflight !== false }), { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/wiki/docs/{docId} → removes the document (source PDF, wiki, state). 409 while it is being built.
export async function DELETE(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  try {
    return Response.json(await deleteDoc(docId), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
