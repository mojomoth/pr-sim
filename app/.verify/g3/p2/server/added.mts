import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@/server/wiki/markdown";
import { regroundCitations } from "@/server/wiki/reground";
const dir = process.argv[2];
const raw = readdirSync(join(dir, "raw/pages")).sort().map((f) => readFileSync(join(dir, "raw/pages", f), "utf8"));
let g = 0, fx = 0, ad = 0;
for (const f of readdirSync(join(dir, "wiki"))) {
  const { fm, body } = parseFrontmatter(readFileSync(join(dir, "wiki", f), "utf8"));
  if (fm.type === "numbers" || fm.type === "meta") continue;
  const r = regroundCitations(body, raw);
  g += r.stats.groups; fx += r.stats.fixed; ad += r.stats.added;
  const a = body.split("\n"), b = r.body.split("\n");
  a.forEach((l, i) => { if (l !== b[i]) console.log(f, "|", b[i].slice(-110)); });
}
console.log({ groups: g, fixed: fx, added: ad });
