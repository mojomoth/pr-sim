import { deleteJudge, generateJudge, listJudges } from "@/judge/lib";
import { errorResponse, parseCommon, parseTemperament, readJson } from "@/judge/lib/http";

// GET /api/judge → { judges: JudgeRecord[] } (newest first)
export async function GET() {
  return Response.json({ judges: await listJudges() }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/judge { temperament, quality?, replaceId? } → JudgeRecord
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const temperament = parseTemperament(body.temperament);
    const judge = await generateJudge(temperament, { ...parseCommon(body), signal: req.signal });
    if (typeof body.replaceId === "string") await deleteJudge(body.replaceId);
    console.log(`[judge] generated ${judge.id} ${temperament} ${judge.gender}/${judge.age} ${judge.quality} ${judge.ms}ms`);
    return Response.json(judge, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
