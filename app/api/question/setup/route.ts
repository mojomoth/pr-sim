import { ensureFixtureDocs, setupData, warmLint } from "@/question/lib";

// GET /api/question/setup → sample inputs (situation, transcript, judges), script transcript, wiki docs, generated judge faces
export async function GET() {
  try {
    const data = await setupData();
    warmLint(data.defaults);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/question/setup {action:"ingest-fixtures"} → ingest fixture PDFs into the wiki (reused by hash)
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "ingest-fixtures") return Response.json({ error: "unknown action" }, { status: 400 });
  try {
    const t0 = Date.now();
    const r = await ensureFixtureDocs();
    return Response.json({ ...r, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
