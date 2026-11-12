import { cors, errorResponse, guard, NO_STORE, preflight } from "@/server/http";
import { mintLiveToken } from "@/server/stt/token";

// runtime: default nodejs (the segment option is not allowed with cacheComponents)
export const maxDuration = 10;

// POST /api/stt/token → { token, model, expiresAt, config }
// Single-use Gemini Live token (30 min, model + config locked). The API key never leaves the server.
// Strict origin check: only our own page (bare curl → 403).
export const OPTIONS = preflight;

export const POST = cors(async (req: Request) => {
  const denied = guard(req, "token", true);
  if (denied) return denied;
  try {
    return Response.json(await mintLiveToken(), { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e, "stt/token");
  }
});
