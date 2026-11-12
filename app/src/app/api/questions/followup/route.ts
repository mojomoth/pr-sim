import { ApiError, cors, errorResponse, guard, NO_STORE, preflight, readJson } from "@/server/http";
import { followUp, FollowUpInputError } from "@/server/question/followup";
import { FollowUpIn } from "@/server/question/schema";

// runtime: default nodejs (the segment option is not allowed with cacheComponents)
export const maxDuration = 60;

// POST /api/questions/followup { packText, judge, asked, original, answer, thread, followupsSoFar, remainingSec?,
//   pending, transcript, docs: {role, pageTexts}[] } → { decision, assessment, remark, followup, guard?, usage, latencyMs }
// Stateless: the client sends the run context it keeps in IndexedDB; `usage` names the provider/model that answered.
export const OPTIONS = preflight;

export const POST = cors(async (req: Request) => {
  const denied = guard(req, "followup");
  if (denied) return denied;
  try {
    const body = await readJson(req, FollowUpIn);
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout((maxDuration - 5) * 1000)]);
    return Response.json(await followUp(body, { signal }), { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e instanceof FollowUpInputError ? new ApiError("bad_request", "다른 심사위원의 질문이라 이어서 물을 수 없어요.") : e, "questions/followup");
  }
});
