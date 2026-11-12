// Transpile src/components/*.tsx to CJS with next/* stubbed, then SSR a gallery to static HTML.
const ts = require("/Users/jyl/work/study/pr-sim/app/node_modules/typescript");
const fs = require("fs"), path = require("path");
const SRC = "/Users/jyl/work/study/pr-sim/app/src/components", OUT = __dirname + "/c";
for (const f of fs.readdirSync(SRC)) {
  let code = fs.readFileSync(path.join(SRC, f), "utf8");
  code = code.replace(/from "next\/link"/g, 'from "../stub-link"').replace(/from "next\/navigation"/g, 'from "../stub-nav"');
  const out = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  fs.writeFileSync(path.join(OUT, f.replace(/\.tsx$/, ".js")), out.outputText);
}
