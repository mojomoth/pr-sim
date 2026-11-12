import { lintWiki } from "@/wiki/lib";
import { docParam, errorResponse, jsonError } from "@/wiki/lib/http";
import { isDocId, readLint } from "@/wiki/lib/store";

// GET  /api/wiki/docs/{docId}/lint?against=<docId> → last LintReport, or null if never run
// POST /api/wiki/docs/{docId}/lint { against? }       → runs LINT now
export async function GET(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  const against = new URL(req.url).searchParams.get("against") ?? undefined;
  if (against && !isDocId(against)) return jsonError(400, "invalid against");
  const r = await readLint(docId, against);
  return Response.json(r ?? null, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { against?: unknown };
  const against = typeof b.against === "string" && b.against ? b.against : undefined;
  if (against && (!isDocId(against) || against === docId)) return jsonError(400, "invalid against");
  try {
    return Response.json(await lintWiki(docId, { against }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
