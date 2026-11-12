import { parseSessionRecord } from "@/fixtures/lib";
import type { SessionRecord } from "@/lib/types";
import { generateReport, getSession, isProvider, ReportIncompleteError, type ProgressEvent } from "@/report/lib";

export const maxDuration = 600;

// POST /api/report/generate { ref?: string, session?: SessionRecord, force?: boolean, provider?: "claude"|"openai"|"gemini" }
// → application/x-ndjson stream of ProgressEvent lines: steps → step… → done{report} | cached{key} → done | error{error, failedSteps, retryable}
// A report is cached only when every evaluated section succeeded; on failure nothing is written (a good cached report survives a failed 다시 생성).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ref?: string; session?: unknown; force?: boolean; provider?: unknown } | null;
  if (!body) return Response.json({ error: "JSON 본문이 필요합니다" }, { status: 400 });
  let session: SessionRecord | null = null;
  if (body.session) {
    try {
      session = parseSessionRecord(body.session);
    } catch (e) {
      return Response.json({ error: "SessionRecord 형식이 아닙니다", detail: e instanceof Error ? e.message.slice(0, 600) : String(e) }, { status: 400 });
    }
  } else if (typeof body.ref === "string") session = await getSession(body.ref);
  if (!session) return Response.json({ error: "세션을 찾을 수 없습니다 (ref 또는 session 필요)" }, { status: 404 });

  const enc = new TextEncoder();
  const s = session;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: ProgressEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false; // client went away — the job keeps running and is cached
        }
      };
      try {
        const report = await generateReport(s, { force: !!body.force, provider: isProvider(body.provider) ? body.provider : undefined, onProgress: (e) => e.type !== "done" && e.type !== "error" && send(e) });
        send({ type: "done", report });
      } catch (e) {
        if (e instanceof ReportIncompleteError) send({ type: "error", error: e.message, failedSteps: e.failedSteps, retryable: e.retryable });
        else send({ type: "error", error: "리포트를 만들지 못했어요 — 서버 오류가 발생했어요.", retryable: true });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
