import { saveAnswer } from "@/wiki/lib";
import { docParam, errorResponse, jsonError } from "@/wiki/lib/http";

// POST /api/wiki/docs/{docId}/answers { query, answer, pages? } → { savedAs }
// Files the answer the user already saw into the wiki as an analysis page (no new LLM call).
export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.query !== "string" || typeof b.answer !== "string" || !b.query.trim() || !b.answer.trim()) return jsonError(400, "query·answer(문자열)가 필요합니다");
  const pages = Array.isArray(b.pages) ? b.pages.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
  try {
    return Response.json(await saveAnswer(docId, { query: b.query, answer: b.answer, pages }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
