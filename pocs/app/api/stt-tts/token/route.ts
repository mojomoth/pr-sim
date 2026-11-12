import { mintLiveToken } from "@/stt-tts/lib/server";
import { errorResponse, guard } from "@/stt-tts/lib/http";

// POST /api/stt-tts/token -> { token, model, expiresAt, config }
// Ephemeral (single-use, 30 min) Live API token. The real GOOGLE_API_KEY never leaves the server.
// Strict origin check (same-origin page only; bare curl → 403) + 10 tokens/min per client.
export async function POST(req: Request) {
  const denied = guard(req, "token", { strict: true });
  if (denied) return denied;
  try {
    return Response.json(await mintLiveToken(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
