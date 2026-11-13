// Domain terms for Gemini Live `customVocabulary` (biases recognition: 완충재 not 완충제), taken from the
// session's wiki: key-number metric names and page titles, split into words. Compound and coined words
// (3+ chars, or with Latin/digits: 웨이브셀, 버섯균사체, 3PL) come first, since plain two-syllable nouns
// (고객, 생산) are recognized fine; ties go to how often the uploaded pages use the word.
import type { StoredDoc } from "@/features/session/types";

export const MAX_VOCAB = 40;
const MAX_TERM = 40;

export function sessionVocabulary(docs: (StoredDoc | undefined)[]): string[] {
  const ds = docs.filter((d): d is StoredDoc => !!d);
  const text = ds.flatMap((d) => d.pageTexts).join("\n").normalize("NFC");
  const words = new Set<string>();
  for (const d of ds)
    for (const s of [...(d.keyNumbers ?? []).map((k) => k.metric), ...(d.wiki ?? []).filter((p) => p.type !== "meta").map((p) => p.title)])
      for (const w of s.normalize("NFC").replace(/\([^)]*\)/g, " ").split(/[\s·,/–~]+/))
        if (w.length >= 2 && w.length <= MAX_TERM && !/^[\d.~%]+[A-Za-z가-힣]?$/.test(w)) words.add(w);
  const distinct = (w: string) => w.length >= 3 || /[A-Za-z0-9]/.test(w);
  const count = (w: string) => text.split(w).length - 1;
  return [...words]
    .map((w) => [w, count(w)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => Number(distinct(b[0])) - Number(distinct(a[0])) || b[1] - a[1])
    .slice(0, MAX_VOCAB)
    .map(([w]) => w);
}
