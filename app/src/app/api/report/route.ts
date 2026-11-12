import { cors, errorResponse, guard, ndjson, preflight, readJson } from "@/server/http";
import { generateReport, ReportIncompleteError } from "@/server/report/generate";
import { ReportIn } from "@/server/report/schema";
import type { ProgressEvent } from "@/server/report/types";
import { checkDocLimits } from "@/server/wiki/schema";

// runtime: default nodejs (the segment option is not allowed with cacheComponents)
export const maxDuration = 300;

// POST /api/report { session: ReportInput, provider? } → application/x-ndjson of ProgressEvent:
//   steps → step … → {type:"done", report} | {type:"error", code, message, failedSteps?, retryable}
// An incomplete report is never sent. Transcript citations use TranscriptSentence.id; document citations are DocRef pages.
export const OPTIONS = preflight;

export const POST = cors(async (req: Request) => {
  const denied = guard(req, "report");
  if (denied) return denied;
  let body: Awaited<ReturnType<typeof readJson<typeof ReportIn>>>;
  try {
    body = await readJson(req, ReportIn);
    body.session.docs.forEach(checkDocLimits);
  } catch (e) {
    return errorResponse(e, "report");
  }
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout((maxDuration - 20) * 1000)]);
  return ndjson("report", async (send: (e: ProgressEvent) => void) => {
    try {
      const report = await generateReport(body.session, { provider: body.provider, signal, onProgress: (e) => e.type !== "done" && e.type !== "error" && send(e) });
      send({ type: "done", report });
    } catch (e) {
      if (!(e instanceof ReportIncompleteError)) throw e;
      send({ type: "error", code: signal.aborted ? "timeout" : e.code, message: signal.aborted ? "응답 시간이 초과됐어요. 다시 시도해 주세요." : e.message, failedSteps: e.failedSteps, retryable: e.retryable });
    }
  });
});
