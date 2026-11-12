// Test harness (no routes): opens http://localhost:3000/ in headless Chrome and serves the CORE
// TypeScript modules at /__core/<path under src> by intercepting requests (transpiled on the fly
// with the app's TypeScript). Same origin as the app, so /pdfjs, /worklets, /samples and /api/* are real.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { launch } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";

const APP = "/Users/jyl/work/study/pr-sim/app";
const SRC = join(APP, "src");
const require = createRequire(join(APP, "package.json"));
const ts = require("typescript");
export const ORIGIN = "http://localhost:3000";

const NM = {
  "pdfjs-dist": join(APP, "node_modules/pdfjs-dist/build/pdf.min.mjs"),
  "@google/genai": join(APP, "node_modules/@google/genai/dist/web/index.mjs"),
};
const SHIMS = {
  "p-retry": `export default (fn)=>fn(1);`,
};

// Real React (CJS) for the browser: one registry script + ESM facades per entry.
const CJS_ENTRIES = ["react", "react/jsx-runtime", "react-dom", "react-dom/client"];
let cjsBundle = null;
function bundleCjs() {
  if (cjsBundle) return cjsBundle;
  const mods = new Map();
  const visit = (abs) => {
    if (mods.has(abs)) return mods.get(abs).id;
    const code = readFileSync(abs, "utf8");
    const rec = { id: mods.size, code, deps: {} };
    mods.set(abs, rec);
    const req = createRequire(abs);
    for (const m of code.matchAll(/require\((['"])([^'"]+)\1\)/g)) rec.deps[m[2]] = visit(req.resolve(m[2]));
    return rec.id;
  };
  const entries = Object.fromEntries(CJS_ENTRIES.map((e) => [e, visit(require.resolve(e))]));
  const defs = [...mods.values()].map((r) => `${r.id}:[function(module,exports,require){${r.code}\n},${JSON.stringify(r.deps)}]`).join(",\n");
  cjsBundle = `(()=>{const D={${defs}};const C={};const R=(id)=>{if(C[id])return C[id].exports;const m={exports:{}};C[id]=m;const [f,deps]=D[id];f(m,m.exports,(s)=>R(deps[s]));return m.exports;};const E=${JSON.stringify(entries)};globalThis.__cjs=(n)=>R(E[n]);})();`;
  return cjsBundle;
}
const cjsFacade = (name) => {
  const keys = Object.keys(require(name)).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "default");
  return `const m=globalThis.__cjs(${JSON.stringify(name)});export default m;export const {${keys.join(",")}}=m;`;
};

function resolveTs(abs) {
  for (const c of [abs, `${abs}.ts`, `${abs}.tsx`, join(abs, "index.ts")]) if (existsSync(c) && !c.endsWith("/")) try { if (readFileSync(c)) return c; } catch {}
  throw new Error(`cannot resolve ${abs}`);
}

function spec(s, fromFile) {
  if (s.startsWith("@/")) return `/__core/${resolveTs(join(SRC, s.slice(2))).slice(SRC.length + 1)}`;
  if (s.startsWith(".")) return `/__core/${resolveTs(resolve(dirname(fromFile), s)).slice(SRC.length + 1)}`;
  if (NM[s]) return `/__nm/${s}`;
  if (SHIMS[s]) return `/__shim/${s}`;
  if (CJS_ENTRIES.includes(s)) return `/__cjs/${s}`;
  return s;
}

function transpile(file) {
  const out = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: file.replace(/\.src$/, ""), // *.tsx.src: test sources kept out of the app's tsc/eslint scope
  }).outputText;
  return out.replace(/(from\s*|import\s*\(\s*|import\s+)(["'])([^"']+)\2/g, (m, pre, q, s) => `${pre}${q}${spec(s, file)}${q}`);
}

export async function launchCore(opts = {}) {
  const { browser, page, logs } = await launch(opts);
  await page.evaluateOnNewDocument(() => {
    globalThis.process = { env: { NODE_ENV: "development" } };
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.origin !== ORIGIN) return req.continue();
    const js = (body) => req.respond({ status: 200, contentType: "text/javascript", body });
    try {
      if (u.pathname.startsWith("/__core/")) return js(transpile(join(SRC, decodeURIComponent(u.pathname.slice(8)))));
      if (u.pathname.startsWith("/__test/")) return js(transpile(join(dirname(new URL(import.meta.url).pathname), decodeURIComponent(u.pathname.slice(8)))));
      if (u.pathname.startsWith("/__nm/")) {
        const name = decodeURIComponent(u.pathname.slice(6));
        return js(readFileSync(NM[name], "utf8").replace(/from\s*(["'])p-retry\1/g, "from '/__shim/p-retry'"));
      }
      if (u.pathname.startsWith("/__shim/")) return js(SHIMS[u.pathname.slice(8)]);
      if (u.pathname === "/__cjs.js") return js(bundleCjs());
      if (u.pathname.startsWith("/__cjs/")) return js(cjsFacade(decodeURIComponent(u.pathname.slice(7))));
    } catch (e) {
      return req.respond({ status: 500, contentType: "text/plain", body: String(e) });
    }
    return req.continue();
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/__cjs.js" });
  return { browser, page, logs };
}
