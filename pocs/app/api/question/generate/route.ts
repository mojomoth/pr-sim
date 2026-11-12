import { generateQuestions } from "@/question/lib";
import { GenerateIn } from "@/question/lib/schema";
import type { GenerateEvent } from "@/question/lib/types";

export const maxDuration = 300;

// POST /api/question/generate → application/x-ndjson stream of GenerateEvent (one JSON per line).
export async function POST(req: Request) {
  const parsed = GenerateIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "입력 오류", issues: parsed.error.issues }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: GenerateEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await generateQuestions(parsed.data, { onEvent: send, signal: req.signal });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
