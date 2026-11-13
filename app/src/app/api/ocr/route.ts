import { z } from "zod";
import { cors, errorResponse, guard, NO_STORE, preflight, readJson } from "@/server/http";
import { ocrPage } from "@/server/ocr";
import { MAX_DOC_PAGES, OCR_BATCH } from "@/server/types";

export const maxDuration = 120;

const Body = z.object({
  pages: z
    .array(
      z.object({
        page: z.number().int().min(1).max(MAX_DOC_PAGES),
        // base64 JPEG ("/9j/" = FF D8 FF), ≤ ~1MB decoded
        image: z.string().max(1_400_000).regex(/^\/9j\/[A-Za-z0-9+/]+=*$/, "JPEG 이미지여야 해요."),
      }),
    )
    .min(1)
    .max(OCR_BATCH),
});

// POST /api/ocr { pages: [{ page, image: base64 JPEG }] (≤ OCR_BATCH) } → { pages: [{ page, text }], models }
// For PDFs whose pages have no text layer (scans, image exports). The client renders the pages and sends them in batches.
export const OPTIONS = preflight;

export const POST = cors(async (req: Request) => {
  const denied = guard(req, "ocr");
  if (denied) return denied;
  try {
    const body = await readJson(req, Body);
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout((maxDuration - 10) * 1000)]);
    const out = await Promise.all(body.pages.map(async (p) => ({ page: p.page, ...(await ocrPage(p.image, signal)) })));
    return Response.json({ pages: out.map(({ page, text }) => ({ page, text })), models: [...new Set(out.map((o) => o.model))] }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e, "ocr");
  }
});
