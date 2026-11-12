import { transcribeAudio } from "@/stt-tts/lib/server";
import { errorResponse, guard } from "@/stt-tts/lib/http";

// POST /api/stt-tts/transcribe  body: raw audio (audio/wav, audio/webm …) or multipart field "audio"
// -> { text, sentences[], model, ms }
export async function POST(req: Request) {
  const denied = guard(req, "transcribe");
  if (denied) return denied;
  try {
    const ct = req.headers.get("content-type") ?? "";
    let buf: Buffer;
    let mime = ct;
    if (ct.startsWith("multipart/form-data")) {
      const f = (await req.formData()).get("audio");
      if (!(f instanceof Blob)) return Response.json({ error: "audio 필드가 없습니다." }, { status: 400 });
      buf = Buffer.from(await f.arrayBuffer());
      mime = f.type || "audio/wav";
    } else {
      buf = Buffer.from(await req.arrayBuffer());
    }
    if (buf.byteLength > 20 * 1024 * 1024) return Response.json({ error: "오디오가 너무 큽니다 (20MB 초과)." }, { status: 413 });
    return Response.json(await transcribeAudio(buf, mime || "audio/wav"));
  } catch (e) {
    return errorResponse(e);
  }
}
