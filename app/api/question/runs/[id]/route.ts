import { loadRun } from "@/question/lib";

// GET /api/question/runs/<id> → QuestionRun (context pack, questions, QA log)
export async function GET(_req: Request, ctx: RouteContext<"/api/question/runs/[id]">) {
  const { id } = await ctx.params;
  const r = await loadRun(id);
  return r ? Response.json(r) : Response.json({ error: "not found" }, { status: 404 });
}
