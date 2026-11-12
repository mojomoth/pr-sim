import { judgeSpeech } from "@/question/lib/tts";
import { errorResponse } from "@/stt-tts/lib/http";
import { TtsIn } from "@/question/lib/schema";

export const maxDuration = 120;

// POST /api/question/tts {text, gender, age, temperament} → audio/wav in the judge's voice
// (stt-tts synthesizeSpeech / Gemini, disk-cached; OpenAI gpt-4o-mini-tts fallback when the Gemini daily quota is gone)
export async function POST(req: Request) {
  const parsed = TtsIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "입력 오류", issues: parsed.error.issues }, { status: 400 });
  const t0 = Date.now();
  try {
    const { text, ...p } = parsed.data;
    const r = await judgeSpeech(text, p);
    return new Response(new Uint8Array(r.wav), {
      headers: {
        "content-type": "audio/wav",
        "cache-control": "no-store",
        "x-voice": r.voice,
        "x-provider": r.provider,
        "x-model": r.model ?? "",
        "x-cache": r.cached ? "HIT" : "MISS",
        "x-duration": String(r.durationSec ?? ""),
        "x-ms": String(Date.now() - t0),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
