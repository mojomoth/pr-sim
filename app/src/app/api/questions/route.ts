import { cors, errorResponse, guard, ndjson, preflight, readJson } from "@/server/http";
import { generateQuestions } from "@/server/question/generate";
import { GenerateIn } from "@/server/question/schema";
import type { GenerateEvent } from "@/server/question/types";
import { checkDocLimits } from "@/server/wiki/schema";

// runtime: default nodejs (the segment option is not allowed with cacheComponents)
export const maxDuration = 120;

// POST /api/questions { situation, qaMinutes, presentationMinutes?, transcript, docs: DocInput[], judges (1–3),
//   avoidQuestions?, pack?, lint? } → application/x-ndjson of GenerateEvent:
//   stage · context · plan · delta · question · judge-done · {type:"error", judgeId, message} (one judge failed)
//   … {type:"done", order, main, reserve, questions, pack, lint, usage, timings} | {type:"error", code, message, retryable}
// `pack` given → the context is reused (no wiki queries / lint): send only the judges to regenerate.
export const OPTIONS = preflight;

export const POST = cors(async (req: Request) => {
  const denied = guard(req, "questions");
  if (denied) return denied;
  let body: Awaited<ReturnType<typeof readJson<typeof GenerateIn>>>;
  try {
    body = await readJson(req, GenerateIn);
    body.docs.forEach(checkDocLimits);
  } catch (e) {
    return errorResponse(e, "questions");
  }
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout((maxDuration - 10) * 1000)]);
  return ndjson("questions", (send: (e: GenerateEvent) => void) => generateQuestions(body, { onEvent: send, signal }));
});
