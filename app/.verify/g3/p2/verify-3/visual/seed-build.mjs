// Builds seed.json: a SessionRecord (status "setup", 1-min presentation / 1-min Q&A) + blobs (base64)
// from the sample PDFs (page texts via pdfjs-dist, same extraction as features/slide/pdf.ts),
// the API agent's wiki runs, and three PoC judge photos. Injected into IndexedDB by run.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const APP = "/Users/jyl/work/study/pr-sim/app";
const require = createRequire(APP + "/package.json");
const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"));

async function pageTexts(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    let s = "";
    for (const it of c.items) if ("str" in it) s += it.str + (it.hasEOL ? "\n" : "");
    out.push(s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim());
  }
  return out;
}
function wikiDone(file) {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return lines.find((l) => l.type === "done");
}
const blobs = {};
const docs = {};
for (const role of ["presentation", "proposal"]) {
  const bytes = readFileSync(`${APP}/public/samples/${role}.pdf`);
  const docId = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const texts = await pageTexts(bytes);
  const w = wikiDone(`${APP}/.verify/g2/api/wiki-${role}.ndjson`);
  blobs[`pdf:${docId}`] = { type: "application/pdf", b64: bytes.toString("base64") };
  docs[role] = {
    role, docId, filename: `${role}.pdf`, bytes: bytes.length, pageCount: texts.length, pdfKey: `pdf:${docId}`,
    pageTexts: texts, emptyPages: texts.flatMap((t, i) => (t.replace(/\s/g, "").length < 20 ? [i + 1] : [])),
    wikiState: "ready", wiki: w.wiki, keyNumbers: w.keyNumbers, wikiBuiltAt: new Date().toISOString(),
  };
}
const PICK = ["j_mwdja2lbcyyyv", "j_mwdjbetg50soz", "j_mwdja1fzc0gw5"];
const judges = PICK.map((jid) => {
  const d = JSON.parse(readFileSync(`/Users/jyl/work/study/pr-sim/pocs/.data/judge/${jid}.json`, "utf8"));
  blobs[`judge:${jid}`] = { type: "image/webp", b64: readFileSync(`/Users/jyl/work/study/pr-sim/pocs/.data/judge/${jid}.webp`).toString("base64") };
  blobs[`judge:${jid}:thumb`] = { type: "image/webp", b64: readFileSync(`/Users/jyl/work/study/pr-sim/pocs/.data/judge/${jid}.thumb.webp`).toString("base64") };
  return { id: jid, name: d.name, temperament: d.temperament, gender: d.gender, age: d.age, fullName: d.fullName, voiceHint: d.voiceHint, imageKey: `judge:${jid}`, thumbKey: `judge:${jid}:thumb` };
});
const now = new Date().toISOString();
const situation = readFileSync(`${APP}/.verify/g2/api/questions.ndjson`, "utf8").match(/"situation":"([^"]+)"/)?.[1] ?? "친환경 패키징 사업 Pre-A 투자 유치 피칭";
const session = {
  id: "s_g2screensb", status: "setup", setup: { situation, presentationMinutes: 1, qaMinutes: 1 },
  docs, judges, transcript: [], qa: [], createdAt: now, updatedAt: now,
};
writeFileSync(new URL("./seed.json", import.meta.url), JSON.stringify({ session, blobs }));
console.log("seed ok", { pages: [docs.presentation.pageCount, docs.proposal.pageCount], judges: judges.map((j) => `${j.name}/${j.temperament}`), situation: situation.slice(0, 60) });
