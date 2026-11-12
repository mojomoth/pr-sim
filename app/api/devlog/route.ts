import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = await readFile(join(process.cwd(), "devlog", "events.jsonl"), "utf8");
    const events = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
    return Response.json({ events });
  } catch {
    return Response.json({ events: [] });
  }
}
