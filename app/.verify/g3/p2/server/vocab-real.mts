// sessionVocabulary on the real proposal wiki (pocs store cb3e5a08f4107921).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@/server/wiki/markdown";
import { sessionVocabulary } from "@/features/stt/vocab";
const dir = process.argv[2];
const pageTexts = readdirSync(join(dir, "raw/pages")).sort().map((f) => readFileSync(join(dir, "raw/pages", f), "utf8"));
const kn = JSON.parse(readFileSync(join(dir, "state/keynumbers.json"), "utf8"));
const wiki = readdirSync(join(dir, "wiki")).map((f) => { const { fm } = parseFrontmatter(readFileSync(join(dir, "wiki", f), "utf8")); return { slug: f, title: String(fm.title ?? ""), type: String(fm.type ?? ""), summary: "", sources: [], markdown: "" }; });
const v = sessionVocabulary([{ pageTexts, keyNumbers: Array.isArray(kn) ? kn : kn.rows, wiki } as never]);
console.log(v.length, v.join(", "), JSON.stringify(v).length + " chars");
