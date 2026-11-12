import { loadSession } from "@/question/lib";

// GET /api/question/sessions/<id> → { record: SessionRecord, meta }
export async function GET(_req: Request, ctx: RouteContext<"/api/question/sessions/[id]">) {
  const { id } = await ctx.params;
  const s = await loadSession(id);
  return s ? Response.json(s) : Response.json({ error: "not found" }, { status: 404 });
}
