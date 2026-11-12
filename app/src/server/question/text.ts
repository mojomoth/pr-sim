import "server-only";
// Small text utilities shared by context building, grounding and dedupe (isomorphic).

const FILLERS = /(^|\s)(음+|어+|그+|아+|그러니까|저기|뭐랄까),?(?=\s|$)/g;

export function stripFillers(s: string): string {
  return s.replace(FILLERS, " ").replace(/\s+/g, " ").trim();
}

/** Normalize for verbatim-quote matching: NFKC, unify quotes/dashes, drop all whitespace. */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[“”„‟"]/g, '"')
    .replace(/[‘’‚‛']/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[·ㆍ•]/g, "·")
    .replace(/\s+/g, "")
    .replace(/[.,]$/g, "");
}

const UNIT = "(?:퍼센트|%|원|억|만|천|조|개|곳|건|톤|세트|배|년|월|일|분기|명|주|초|시간|kg|g)";
const NUM_RE = new RegExp(`\\d[\\d,]*(?:\\.\\d+)?\\s*${UNIT}?`, "g");

/** Number tokens like "118원", "28%", "340억", "2027년" (퍼센트 → %). */
export function numberTokens(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.normalize("NFKC").matchAll(NUM_RE)) {
    const t = m[0].replace(/\s+/g, "").replace(/,/g, "").replace("퍼센트", "%");
    if (/^\d$/.test(t)) continue; // single bare digit is noise
    out.add(t);
  }
  return [...out];
}

const STOP = new Set(["그리고", "그래서", "저희는", "저희", "있습니다", "합니다", "됩니다", "입니다", "있는", "하는", "이번", "오늘", "여러분", "정도", "이렇게", "말씀드리겠습니다", "기준으로", "약", "현재", "이제"]);

/** Korean/latin content words (>=2 chars), particles crudely stripped. */
export function keywords(s: string): string[] {
  const out = new Set<string>();
  for (const w of s.normalize("NFKC").split(/[^0-9A-Za-z가-힣]+/)) {
    if (w.length < 2 || /^\d/.test(w)) continue;
    const base = w.replace(/(으로|에서|에게|까지|부터|이고|이며|입니다|합니다|했습니다|하고|으로는|에는|은|는|이|가|을|를|의|에|와|과|도|로|만)$/u, "");
    if (base.length >= 2 && !STOP.has(base) && !STOP.has(w)) out.add(base);
  }
  return [...out];
}

function bigrams(s: string): Set<string> {
  const t = s.normalize("NFKC").replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** Dice coefficient on character bigrams (0..1). */
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export const approxTokens = (chars: number) => Math.round(chars * 0.6);

export function mmss(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** First numeric value + unit of a string, e.g. "약 14%" → {n:14,u:"%"}. */
export function firstValue(s: string): { n: number; u: string } | null {
  const m = s.normalize("NFKC").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(퍼센트|%|원|억|만|조|개|곳|건|톤|세트|배|년|명)?/);
  if (!m) return null;
  return { n: Number(m[1]), u: (m[2] ?? "").replace("퍼센트", "%") };
}
