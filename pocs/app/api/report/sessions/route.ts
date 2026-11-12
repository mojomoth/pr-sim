import { koSessionIssues, listSessions, saveSession } from "@/report/lib";

// GET /api/report/sessions → SessionSummary[] (fixture + question PoC + saved + test samples, listed dynamically)
export async function GET() {
  return Response.json(await listSessions(), { headers: { "Cache-Control": "no-store" } });
}

// POST /api/report/sessions  body = SessionRecord JSON → { ref, renamed?, duplicate? }
// (same id + different content is saved under "<id>-<hash>" instead of overwriting the earlier paste)
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "JSON 본문이 필요합니다" }, { status: 400 });
  try {
    const { ref, renamed, duplicate } = await saveSession(body);
    return Response.json({ ref, renamed: !!renamed, duplicate: !!duplicate }, { status: 201 });
  } catch (e) {
    // `issues` = Korean lines for the UI; `detail` = raw zod JSON for API clients (never rendered)
    return Response.json(
      { error: "SessionRecord 형식이 아니에요", issues: koSessionIssues(e), detail: e instanceof Error ? e.message.slice(0, 600) : String(e) },
      { status: 400 },
    );
  }
}
