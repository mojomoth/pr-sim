import "server-only";
import type { DocRole, TranscriptSentence } from "../types";
import { norm } from "./text";
import type { Evidence } from "./types";

// Grounding check: is each evidence quote really in the source? (whitespace/quote-normalized substring)
// If the quote exists on another page of the same doc, the page is corrected. If the model put a raw
// quote under the wrong doc, we look in the other doc too.

export function groundEvidence(ev: Evidence[], src: { pages: Partial<Record<DocRole, string[]>>; transcript: TranscriptSentence[] }): Evidence[] {
  const pages = {
    presentation: (src.pages.presentation ?? []).map(norm),
    proposal: (src.pages.proposal ?? []).map(norm),
  };
  const tr = norm(src.transcript.map((s) => s.text).join(" "));
  return ev.map((e) => {
    const q = norm(e.quote).replace(/^…|…$/g, "").replace(/^\.\.\.|\.\.\.$/g, "");
    if (q.length < 4) return { ...e, verified: false };
    if (e.doc === "transcript") return { ...e, page: null, verified: tr.includes(q) };
    const list = pages[e.doc];
    if (e.page && list[e.page - 1]?.includes(q)) return { ...e, verified: true };
    const idx = list.findIndex((p) => p.includes(q));
    if (idx >= 0) return { ...e, verified: true, correctedPage: idx + 1 };
    const other = e.doc === "presentation" ? "proposal" : "presentation";
    const j = pages[other].findIndex((p) => p.includes(q));
    if (j >= 0) return { ...e, doc: other, verified: true, correctedPage: j + 1 };
    if (tr.includes(q)) return { ...e, doc: "transcript", page: null, verified: true };
    return { ...e, verified: false };
  });
}
