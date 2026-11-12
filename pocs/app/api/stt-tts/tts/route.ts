import { z } from "zod";
import { synthesizeSpeech } from "@/stt-tts/lib/server";
import { errorResponse, guard } from "@/stt-tts/lib/http";

const Body = z.object({
  text: z.string().trim().min(1).max(1200),
  gender: z.enum(["male", "female"]),
  age: z.number().min(20).max(70),
  temperament: z.enum(["friendly", "strict", "aggressive"]),
});

// POST /api/stt-tts/tts { text, gender, age, temperament } -> audio/wav
// Response headers carry the resolved persona: x-voice, x-style (URI-encoded), x-model, x-cache, x-duration, x-ms
export async function POST(req: Request) {
  const denied = guard(req, "tts");
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "입력값을 확인해 주세요.", issues: parsed.error.issues }, { status: 400 });
  try {
    const { text, ...persona } = parsed.data;
    const r = await synthesizeSpeech(text, persona);
    return new Response(new Uint8Array(r.wav), {
      headers: {
        "content-type": "audio/wav",
        "cache-control": "no-store",
        "x-voice": r.voice,
        "x-style": encodeURIComponent(r.style),
        "x-model": r.model ?? "",
        "x-cache": r.cached ? "HIT" : "MISS",
        "x-duration": String(r.durationSec ?? ""),
        "x-ms": String(r.ms ?? ""),
        "access-control-expose-headers": "x-voice, x-style, x-model, x-cache, x-duration, x-ms",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
