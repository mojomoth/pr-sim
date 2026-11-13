import { cors, errorResponse, guard, NO_STORE, preflight, readJson } from "@/server/http";
import { mintLiveToken, SttTokenIn } from "@/server/stt/token";

// runtime: default nodejs (the segment option is not allowed with cacheComponents)
export const maxDuration = 10;

// POST /api/stt/token [{ vocabulary?: string[] (≤60 terms, ≤40 chars) }] → { token, model, expiresAt, config }
// Single-use Gemini Live token (30 min, model + config locked). The API key never leaves the server.
// Strict origin check: only our own page (bare curl → 403).
export const OPTIONS = preflight;

export const POST = cors(async (req: Request) => {
  const denied = guard(req, "token", true);
  if (denied) return denied;
  try {
    // the body is optional (older clients send none, with or without a JSON content-type)
    const body = req.headers.get("content-type")?.includes("json") ? await readJson(req, SttTokenIn, {}) : {};
    return Response.json(await mintLiveToken(body.vocabulary), { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e, "stt/token");
  }
});
