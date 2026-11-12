import "server-only";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export type FixtureSlot = "presentation" | "proposal";

/** Locate a sample PDF produced by the fixtures PoC (pocs/fixtures/**). Read-only. */
export function findFixturePdf(slot: FixtureSlot): string | null {
  const root = path.join(process.cwd(), "fixtures");
  const direct = [path.join(root, `${slot}.pdf`), path.join(root, "out", `${slot}.pdf`), path.join(root, "pdf", `${slot}.pdf`)];
  for (const p of direct) if (existsSync(p)) return p;
  // Fallback: any *.pdf under fixtures/ whose name hints the slot.
  const hint = slot === "presentation" ? /(presentation|deck|발표)/i : /(proposal|제안)/i;
  const walk = (dir: string, depth: number): string | null => {
    if (depth > 2 || !existsSync(dir)) return null;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase().endsWith(".pdf") && hint.test(e.name)) return p;
      if (e.isDirectory() && e.name !== "node_modules") {
        const r = walk(p, depth + 1);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(root, 0);
}
