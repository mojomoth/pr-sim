import { z } from "zod";
import { cors, errorResponse, guard, NO_STORE, preflight, readJson, toApiError } from "@/server/http";
import { synthesizeSpeech } from "@/server/tts/speech";

// runtime: default nodejs (the segment option is not allowed with cacheComponents)
export const maxDuration = 60;

const Body = z.object({
  text: z.string().trim().min(1).max(1200),
  gender: z.enum(["male", "female"]),
  age: z.number().min(20).max(70),
  temperament: z.enum(["friendly", "strict", "aggressive"]),
  /** Pin the provider once a session has fallen back to OpenAI, so the judge's voice stays the same. */
  provider: z.enum(["gemini", "openai"]).optional(),
});

// POST /api/tts { text, gender, age, temperament, provider? } → audio/wav
// Headers: x-provider (gemini|openai), x-model, x-voice, x-duration (seconds).
// Every provider failed → 503 { error: { code: "providers_unavailable", message, fallback: "browser" } }.
export const OPTIONS = preflight;

export const POST = cors(async (req: Request) => {
  const denied = guard(req, "tts");
  if (denied) return denied;
  try {
    const { text, provider, ...persona } = await readJson(req, Body);
    const r = await synthesizeSpeech(text, persona, { provider, deadline: Date.now() + 55_000 });
    return new Response(r.wav as Uint8Array<ArrayBuffer>, {
      headers: {
        ...NO_STORE,
        "content-type": "audio/wav",
        "x-provider": r.provider,
        "x-model": r.model,
        "x-voice": r.voice,
        "x-duration": String(r.durationSec),
        "access-control-expose-headers": "x-provider, x-model, x-voice, x-duration",
      },
    });
  } catch (e) {
    // Contract: when no voice could be made (503/504/502), tell the client to read the line on the device.
    const err = toApiError(e, "tts");
    if (err.code === "providers_unavailable" || err.code === "timeout" || err.code === "upstream") err.fallback = "browser";
    return errorResponse(err, "tts");
  }
});
