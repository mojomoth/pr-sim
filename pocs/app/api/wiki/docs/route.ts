import { listDocs } from "@/wiki/lib";

// GET /api/wiki/docs → WikiDocSummary[]
export async function GET() {
  return Response.json(await listDocs(), { headers: { "Cache-Control": "no-store" } });
}
