import { getSession } from "@/report/lib";

// GET /api/report/sessions/{ref} → SessionRecord   (ref = "fixture:sample" | "question:<f>" | "saved:<f>" | "sample:<f>")
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const s = await getSession(decodeURIComponent(ref));
  if (!s) return Response.json({ error: "unknown session" }, { status: 404 });
  return Response.json(s, { headers: { "Cache-Control": "no-store" } });
}
