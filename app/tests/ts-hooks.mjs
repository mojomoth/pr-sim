// Lets `node --test` import app sources as Next/TypeScript does: "@/x" → src/x, extensionless relative
// imports → .ts, and the "server-only" guard → empty module. Node strips the types itself (no deps).
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function find(base) {
  for (const ext of CANDIDATES) {
    const url = new URL(base.href + ext);
    const path = fileURLToPath(url);
    if (existsSync(path) && statSync(path).isFile()) return url.href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    let base = null;
    if (specifier.startsWith("@/")) base = new URL(specifier.slice(2), SRC);
    else if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith(SRC.href)) base = new URL(specifier, context.parentURL);
    const url = base && find(base);
    if (url) return { url, shortCircuit: true, format: /\.tsx?$/.test(url) ? "module-typescript" : undefined };
    return next(specifier, context);
  },
});
