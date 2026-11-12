import { isSampleName, serveSample } from "@/slide/lib/samples";

// GET /api/slide/sample/presentation | /api/slide/sample/proposal → application/pdf (Range supported)
export async function GET(req: Request, ctx: RouteContext<"/api/slide/sample/[name]">) {
  const { name } = await ctx.params;
  if (!isSampleName(name)) return Response.json({ error: "알 수 없는 샘플이에요.", available: ["presentation", "proposal"] }, { status: 404 });
  return serveSample(name, req);
}

export async function HEAD(req: Request, ctx: RouteContext<"/api/slide/sample/[name]">) {
  return GET(req, ctx);
}
