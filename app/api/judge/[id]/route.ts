import { deleteJudge, getJudge } from "@/judge/lib";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const judge = await getJudge(id);
  if (!judge) return Response.json({ error: { kind: "not_found", message: "judge not found" } }, { status: 404 });
  return Response.json(judge);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteJudge(id);
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: { kind: "not_found", message: "judge not found" } }, { status: 404 });
}
