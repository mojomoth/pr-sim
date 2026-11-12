import { readWikiPage } from "@/wiki/lib";
import { jsonError } from "@/wiki/lib/http";
import { isDocId } from "@/wiki/lib/store";

// GET /api/wiki/docs/{docId}/pages/{slug} → text/markdown (frontmatter included)
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string; slug: string }> }) {
  const { docId, slug: rawSlug } = await params;
  if (!isDocId(docId)) return jsonError(400, "invalid docId");
  let slug = rawSlug;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    /* already decoded */
  }
  const md = await readWikiPage(docId, slug);
  if (md == null) return jsonError(404, "page not found");
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" } });
}
