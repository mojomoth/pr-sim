import { followUp } from "@/question/lib";
import { FollowUpIn } from "@/question/lib/schema";
import { FollowUpInputError } from "@/question/lib/followup";
import { friendlyError, ProvidersUnavailableError } from "@/question/lib/providers";

export const maxDuration = 120;

// POST /api/question/followup {runId, judgeId, questionId, answer, remainingSec?, attemptId?} → FollowUpResult (+ attemptId to pass back)
export async function POST(req: Request) {
  const parsed = FollowUpIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "입력 오류", issues: parsed.error.issues }, { status: 400 });
  try {
    return Response.json(await followUp(parsed.data, { signal: req.signal }));
  } catch (e) {
    if (e instanceof FollowUpInputError) return Response.json({ error: e.message }, { status: 400 });
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found/.test(msg)) return Response.json({ error: `찾을 수 없습니다: ${msg}` }, { status: 404 });
    console.warn("[question] followup failed:", msg.slice(0, 300));
    const status = e instanceof ProvidersUnavailableError ? 503 : 500;
    return Response.json({ error: `꼬리질문 판단 실패: ${friendlyError(e, "오류")}` }, { status });
  }
}
