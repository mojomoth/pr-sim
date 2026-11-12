import { queryWiki } from "@/wiki/lib";
import { docParam, errorResponse, jsonError } from "@/wiki/lib/http";

// POST /api/wiki/docs/{docId}/query { query, maxContextChars?, maxPages?, answer?, followLinks?, save?, selector? } → QueryResult
export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.query !== "string" || !b.query.trim()) return jsonError(400, "query(문자열)가 필요합니다");
  try {
    const r = await queryWiki(docId, b.query, {
      maxContextChars: typeof b.maxContextChars === "number" ? b.maxContextChars : undefined,
      maxPages: typeof b.maxPages === "number" ? b.maxPages : undefined,
      answer: b.answer === true,
      followLinks: b.followLinks !== false,
      save: b.save === true,
      selector: b.selector === "lexical" ? "lexical" : "llm",
    });
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
