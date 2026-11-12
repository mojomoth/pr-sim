import { getWikiStatus } from "@/wiki/lib";
import { docParam, jsonError } from "@/wiki/lib/http";

// GET /api/wiki/docs/{docId}/events → text/event-stream; `data: WikiStatus` whenever it changes, closes on ready/error
// (for a rebuild of a ready wiki: when `status.rebuild` is gone). 404 for an unknown docId.
export async function GET(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const docId = await docParam(params);
  if (docId instanceof Response) return docId;
  if (!(await getWikiStatus(docId))) return jsonError(404, "unknown docId");
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = "";
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* gone */
        }
      };
      req.signal.addEventListener("abort", close);
      const deadline = Date.now() + 15 * 60_000;
      while (!closed && Date.now() < deadline) {
        const st = await getWikiStatus(docId);
        const key = st ? `${st.updatedAt}|${st.state}|${st.rebuild?.updatedAt ?? ""}` : "none";
        if (key !== last) {
          last = key;
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(st)}\n\n`));
          } catch {
            break;
          }
        }
        if (!st || (st.state === "ready" && !st.rebuild) || st.state === "error") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" } });
}
