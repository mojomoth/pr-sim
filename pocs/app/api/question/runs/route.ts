import { listRuns } from "@/question/lib";

// GET /api/question/runs → saved QuestionRun summaries (newest first) for replay in the UI
export async function GET() {
  return Response.json({ runs: await listRuns() }, { headers: { "cache-control": "no-store" } });
}
