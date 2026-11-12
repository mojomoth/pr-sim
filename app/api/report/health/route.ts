import { llmHealth } from "@/report/lib";

// GET /api/report/health → which judgment models are currently marked unavailable (quota/auth) by this server process.
// Targets are marked down only after a real call failed with a final error; nothing is probed here (no quota spent).
export async function GET() {
  const targets = llmHealth();
  return Response.json({ available: targets.some((t) => !t.down), targets }, { headers: { "Cache-Control": "no-store" } });
}
