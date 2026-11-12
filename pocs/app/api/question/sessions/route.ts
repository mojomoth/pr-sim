import { listSessions, saveSession } from "@/question/lib";
import { SaveSessionIn } from "@/question/lib/schema";
import { loadRun } from "@/question/lib/store";

// GET /api/question/sessions → saved SessionRecords (summary)
export async function GET() {
  return Response.json({ sessions: await listSessions() }, { headers: { "cache-control": "no-store" } });
}

// POST /api/question/sessions {runId, attemptId?, qa[]} → saves SessionRecord to .data/question/sessions/<id>.json
export async function POST(req: Request) {
  const parsed = SaveSessionIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "입력 오류", issues: parsed.error.issues }, { status: 400 });
  const run = await loadRun(parsed.data.runId);
  if (!run) return Response.json({ error: "run을 찾을 수 없습니다" }, { status: 404 });
  const qa = parsed.data.qa.map((x) => {
    const j = run.input.judges.find((jj) => jj.id === x.judgeId);
    return { ...x, judge: { id: x.judgeId, name: j?.name ?? x.judgeId, temperament: j?.temperament ?? ("strict" as const) } };
  });
  try {
    const r = await saveSession(parsed.data.runId, qa, parsed.data.attemptId);
    return Response.json({ id: r.id, file: r.file, qa: r.record.qa.length });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
