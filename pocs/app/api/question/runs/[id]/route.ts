import { loadRun } from "@/question/lib";
import { loadAttempt } from "@/question/lib/store";

// GET /api/question/runs/<id>[?attempt=a_x] → QuestionRun (context pack, questions) [+ attempt: that Q&A session's follow-ups + QA log]
export async function GET(req: Request, ctx: RouteContext<"/api/question/runs/[id]">) {
  const { id } = await ctx.params;
  const r = await loadRun(id);
  if (!r) return Response.json({ error: "not found" }, { status: 404 });
  const aid = new URL(req.url).searchParams.get("attempt");
  if (!aid) return Response.json(r);
  return Response.json({ ...r, attempt: await loadAttempt(id, aid) });
}
