import { readFile } from "node:fs/promises";
import { getDocumentProxy, extractText } from "unpdf";
const pdf = await getDocumentProxy(new Uint8Array(await readFile("fixtures/proposal.pdf")));
const { text } = await extractText(pdf, { mergePages: false });
const keys = process.argv.slice(2);
text.forEach((t, i) => { const s = t.replace(/\s+/g, " "); for (const k of keys) { let idx = s.indexOf(k); while (idx >= 0) { console.log(`p${i+1} [${k}]: …${s.slice(Math.max(0, idx-90), idx+70)}…`); idx = s.indexOf(k, idx+1); } } });
