import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { findFixturePdf, type FixtureSlot } from "@/ui/lib/fixture";

// GET /api/ui/fixture?slot=presentation|proposal          → sample PDF from pocs/fixtures (404 if not generated yet)
// GET /api/ui/fixture?slot=presentation|proposal&check=1  → { exists, name?, size? } (always 200; avoids console 404s)
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const slot: FixtureSlot = sp.get("slot") === "proposal" ? "proposal" : "presentation";
  const p = findFixturePdf(slot);
  if (sp.get("check")) {
    if (!p) return Response.json({ exists: false, slot });
    const s = await stat(p);
    return Response.json({ exists: true, slot, name: path.basename(p), size: s.size });
  }
  if (!p) return Response.json({ error: "fixture not found", slot }, { status: 404 });
  const buf = await readFile(p);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(buf.byteLength),
      "x-file-name": encodeURIComponent(path.basename(p)),
      "cache-control": "no-store",
    },
  });
}
