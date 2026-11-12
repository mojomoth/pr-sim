// Run the wiki lib (TypeScript, Next-style imports) in plain Node for tests: transpile .ts with the project's
// typescript, resolve "@/…" and extensionless relative imports, stub "server-only", and swap "@/lib/ai" for a fake
// AI client (mock-ai.mjs) so no real provider is called.
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const POCS = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const MOCK_AI = pathToFileURL(path.join(POCS, "wiki/tests/r3/mock-ai.mjs")).href;

function asTs(p) {
  for (const c of [p, `${p}.ts`, `${p}.tsx`, path.join(p, "index.ts")]) if (existsSync(c) && !c.endsWith("/") && (c.endsWith(".ts") || c.endsWith(".tsx"))) return c;
  return null;
}

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (spec === "@/lib/ai") return { url: MOCK_AI, shortCircuit: true };
    if (spec.startsWith("@/")) {
      const f = asTs(path.join(POCS, spec.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith("file:") && ctx.parentURL.endsWith(".ts")) {
      const f = asTs(path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.startsWith("file:") && (url.endsWith(".ts") || url.endsWith(".tsx"))) {
      const src = readFileSync(fileURLToPath(url), "utf8");
      const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: fileURLToPath(url) });
      return { format: "module", source: out.outputText, shortCircuit: true };
    }
    return next(url, ctx);
  },
});
