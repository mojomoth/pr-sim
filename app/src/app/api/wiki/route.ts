import { z } from "zod";
import { isLiteFallback } from "@/server/ai";
import { cors, errorResponse, guard, ndjson, preflight, readJson } from "@/server/http";
import { buildWiki } from "@/server/wiki/ingest";
import { checkDocLimits, DocIn } from "@/server/wiki/schema";
import { toWikiPages, wikiDocFrom } from "@/server/wiki/store";
import type { WikiEvent } from "@/server/wiki/types";

// runtime: default nodejs (the segment option is not allowed with cacheComponents)
export const maxDuration = 300;

const Body = z.object({ doc: DocIn.omit({ wiki: true, keyNumbers: true }) });

// POST /api/wiki { doc: DocInput (page texts, no wiki) } → application/x-ndjson:
//   {type:"progress", phase, chunksDone, chunksTotal, roundsDone, roundsTotal, msg} …
//   {type:"done", wiki: WikiPage[], keyNumbers, usage (by "provider:model"), ms, degraded} | {type:"error", code, message, retryable}
// degraded = some pages were written by a last-resort Gemini lite model (OpenAI/Claude unavailable) — show that in the UI.
// 413 over 120 pages / 150k chars, 422 when < 30 % of pages carry text. The build stops 20 s before maxDuration (504).
export const OPTIONS = preflight;

export const POST = cors(async (req: Request) => {
  const denied = guard(req, "wiki");
  if (denied) return denied;
  let body: z.infer<typeof Body>;
  try {
    body = await readJson(req, Body);
    checkDocLimits(body.doc);
  } catch (e) {
    return errorResponse(e, "wiki");
  }
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout((maxDuration - 20) * 1000)]);
  return ndjson("wiki", async (send: (e: WikiEvent) => void) => {
    const doc = wikiDocFrom(body.doc);
    const { usage, ms } = await buildWiki(doc, { onProgress: send, signal });
    const degraded = Object.keys(usage).some((k) => isLiteFallback(k.split(":")[1] ?? ""));
    send({ type: "done", wiki: toWikiPages(doc), keyNumbers: doc.keyNumbers, usage, ms, degraded });
  });
});
