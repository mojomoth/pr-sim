import { readCachedReport } from "@/report/lib";

// GET /api/report/reports/{key}[?download=1] → cached Report JSON
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const r = await readCachedReport(key);
  if (!r) return Response.json({ error: "unknown report" }, { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(JSON.stringify(r, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="pr-sim-report-${key}.json"` } : {}),
    },
  });
}
