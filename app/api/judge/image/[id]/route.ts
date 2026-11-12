import type { NextRequest } from "next/server";
import { readImage, type ImageVariant } from "@/judge/lib/store";

// GET /api/judge/image/<id>[?size=thumb|card] → image/webp (full 1024px, card 512px, thumb 256px). Ids are never reused, so cache forever.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const size = req.nextUrl.searchParams.get("size");
  const variant: ImageVariant = size === "thumb" ? "thumb" : size === "card" ? "card" : "full";
  const buf = await readImage(id, variant);
  if (!buf) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const etag = `"${id}-${variant}-${buf.length}"`;
  const headers = { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", ETag: etag };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(buf), { headers: { ...headers, "Content-Length": String(buf.length) } });
}
