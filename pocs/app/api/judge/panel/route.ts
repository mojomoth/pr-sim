import { isTemperament, startPanel, TEMPERAMENTS } from "@/judge/lib";
import { errorBody, errorResponse, parseCommon, readJson } from "@/judge/lib/http";
import { JudgeGenError } from "@/judge/lib/errors";
import type { Temperament } from "@/lib/types";

// POST /api/judge/panel { temperaments?: Temperament[] (default: all 3), quality? }
// → application/x-ndjson stream, one line per event:
//   {type:"start", slots:[{slot,temperament}]} · {type:"judge", slot, judge} · {type:"error", slot, temperament, error} · {type:"done", ms}
export async function POST(req: Request) {
  let temperaments: Temperament[];
  let common: ReturnType<typeof parseCommon>;
  try {
    const body = await readJson(req);
    const raw = Array.isArray(body.temperaments) ? body.temperaments : [...TEMPERAMENTS];
    if (!raw.length || raw.length > 6 || !raw.every(isTemperament)) throw new JudgeGenError("bad_request", "temperaments must be 1–6 of friendly | strict | aggressive");
    temperaments = raw as Temperament[];
    common = parseCommon(body);
  } catch (e) {
    return errorResponse(e);
  }

  const t0 = Date.now();
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          /* client went away */
        }
      };
      send({ type: "start", slots: temperaments.map((temperament, slot) => ({ slot, temperament })) });
      const jobs = startPanel(temperaments, { ...common, signal: req.signal });
      await Promise.all(
        jobs.map((p, slot) =>
          p.then(
            (judge) => send({ type: "judge", slot, judge }),
            (e) => send({ type: "error", slot, temperament: temperaments[slot], ...errorBody(e).body }),
          ),
        ),
      );
      send({ type: "done", ms: Date.now() - t0 });
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
