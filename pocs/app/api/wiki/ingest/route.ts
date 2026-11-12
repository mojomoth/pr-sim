import { startIngest } from "@/wiki/lib";
import { MAX_PDF_BYTES, errorResponse, isSample, jsonError, readSample, SAMPLES } from "@/wiki/lib/http";

// POST /api/wiki/ingest
//   multipart/form-data: file=<pdf>, kind?=presentation|proposal
//   application/json:    { sample: "presentation" | "proposal" | "large", kind? }
// → { docId, reused }  (ingestion continues in the background; follow /api/wiki/docs/{docId}/events)
export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") ?? "";
    let buf: Buffer;
    let filename: string;
    let kind: "presentation" | "proposal" | undefined;
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) return jsonError(400, "multipart 본문을 읽을 수 없습니다 (file 필드에 PDF를 담아 보내세요)");
      const file = form.get("file");
      if (!(file instanceof File)) return jsonError(400, "file 필드가 필요합니다");
      if (file.size > MAX_PDF_BYTES) return jsonError(413, "PDF는 50MB 이하만 받습니다");
      buf = Buffer.from(await file.arrayBuffer());
      filename = file.name || "upload.pdf";
      const k = form.get("kind");
      kind = k === "presentation" || k === "proposal" ? k : undefined;
    } else {
      const body = (await req.json().catch(() => ({}))) as { sample?: unknown; kind?: unknown };
      if (!isSample(body.sample)) return jsonError(400, "sample은 presentation | proposal | large 중 하나");
      buf = await readSample(body.sample);
      filename = SAMPLES[body.sample].filename;
      kind = body.kind === "presentation" || body.kind === "proposal" ? body.kind : SAMPLES[body.sample].kind;
    }
    const r = await startIngest(buf, filename, { kind });
    return Response.json(r, { status: r.reused ? 200 : 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
