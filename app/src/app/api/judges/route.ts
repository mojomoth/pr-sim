import { z } from "zod";
import { MODELS } from "@/server/ai";
import { cors, errorResponse, guard, ndjson, preflight, readJson, toApiError } from "@/server/http";
import { startPanel } from "@/server/judge/generate";
import type { JudgeEvent } from "@/server/judge/types";

// runtime: default nodejs (the segment option is not allowed with cacheComponents)
export const maxDuration = 120;

const Temperament = z.enum(["friendly", "strict", "aggressive"]);
const Body = z.object({
  temperaments: z.array(Temperament).min(1).max(3),
  /** Replacing one judge: send length-1 temperaments and the judges being kept here. */
  avoid: z
    .object({
      names: z.array(z.string().max(20)).max(6).optional(),
      surnames: z.array(z.string().max(5)).max(6).optional(),
      genders: z.array(z.enum(["male", "female"])).max(6).optional(),
      ages: z.array(z.number().int().min(20).max(80)).max(6).optional(),
    })
    .optional(),
});

// POST /api/judges { temperaments (1–3), avoid? } → application/x-ndjson, one line per event:
//   {type:"judge", slot, judge: JudgeOut, model} · {type:"error", slot, code, message} · {type:"done", ms}
export const OPTIONS = preflight;

export const POST = cors(async (req: Request) => {
  const denied = guard(req, "judges");
  if (denied) return denied;
  let body: z.infer<typeof Body>;
  try {
    body = await readJson(req, Body);
  } catch (e) {
    return errorResponse(e, "judges");
  }
  const t0 = Date.now();
  return ndjson("judges", async (send: (e: JudgeEvent) => void) => {
    const jobs = startPanel(body.temperaments, body.avoid, req.signal);
    await Promise.all(
      jobs.map((p, slot) =>
        p.then(
          (judge) => send({ type: "judge", slot, judge, model: MODELS.openaiImage }),
          (e) => {
            const err = toApiError(e, "judges");
            send({ type: "error", slot, code: err.code, message: err.message });
          },
        ),
      ),
    );
    send({ type: "done", ms: Date.now() - t0 });
  });
});
