import { checkProviders } from "@/hil/lib/providers";

export const dynamic = "force-dynamic";

// GET /api/hil/providers[?force=1] — which LLM providers answer right now (cached 60s).
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const report = await checkProviders(force);
  return Response.json(report, { headers: { "cache-control": "no-store" } });
}
