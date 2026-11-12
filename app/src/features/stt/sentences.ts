// Korean sentence segmentation for live STT chunks.
//
// STT returns text in arbitrary chunks (Live: one "final" per utterance/pause; batch: one per VAD
// segment). A chunk can hold several sentences, or end mid-sentence when the speaker pauses.
// splitSentences() cuts the complete sentences off and returns the unfinished tail; SentenceAssembler
// carries that tail into the next chunk so a sentence spoken across a pause becomes ONE bubble.

/** Terminal punctuation, incl. full-width and ellipsis. */
const TERMINAL = ".!?。？！…";
/** Closing marks that may follow terminal punctuation and belong to the same sentence. */
const CLOSERS = "\"'”’)]」』〉》";

/**
 * Unambiguous Korean sentence-final endings (종결어미, 2+ syllables). Used (a) to decide whether an
 * unpunctuated tail is a finished sentence. Bare one-syllable 다/까/요 are handled separately in
 * bareEndingFinal(): they also end common nouns (수요, 중요, 필요, 주요, 바다, 마다 …).
 */
const FINAL_ENDINGS = [
  "습니다", "습니까", "ㅂ니다", "니다", "니까",
  "어요", "아요", "에요", "예요", "해요", "세요", "네요", "군요", "죠", "지요", "데요", "걸요", "니요",
  "까요", "래요", "대요", "나요", "가요", "거든요", "는데요", "잖아요", "고요", "구요",
  "이다", "하다", "되다",
];
/**
 * Words ending in 다/요/까 that are usually NOT sentence-final when the recognizer stops after them
 * (nouns, particles). Checked against the last word.
 */
const NOT_FINAL = ["보다", "바다", "마다", "개요", "수요", "중요", "필요", "주요", "소요", "강요", "요요"];
/** Endings that are safe to split on inside unpunctuated text (strong, unambiguous). */
const STRONG_ENDINGS = ["습니다", "습니까", "ㅂ니다", "니다", "니까", "어요", "아요", "에요", "예요", "해요", "세요", "네요", "까요", "죠", "거든요", "는데요", "잖아요"];

/** Hangul syllable → { jung: vowel index 0–20, jong: final consonant index 0–27 } or null. */
function syllable(ch: string | undefined): { jung: number; jong: number } | null {
  if (!ch) return null;
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  return { jung: Math.floor(c / 28) % 21, jong: c % 28 };
}
// vowels of contracted 해요체 stems: ㅏ ㅐ ㅒ ㅓ ㅔ ㅕ ㅖ ㅘ ㅙ ㅚ ㅝ ㅞ  (봐요, 돼요, 줘요, 써요, 할게요 …)
const YO_VOWELS = new Set([0, 1, 3, 4, 5, 6, 7, 9, 10, 11, 14, 15]);
const JONG_RIEUL = 8;

/**
 * Bare one-syllable endings, decided by the preceding syllable:
 *  - …요: only after an open syllable with a 해요체 vowel (봐요/돼요/줘요/써요) — not 수요/중요/필요/주요
 *  - …다: only after a syllable with a final consonant (한다/했다/있다/없다/같다/좋다) — not 보다/바다/마다
 *  - …까: only after ㄹ-final (할까/볼까/일까)
 */
function bareEndingFinal(word: string): boolean {
  if (word.length < 2) return false;
  const last = word[word.length - 1];
  const prev = syllable(word[word.length - 2]);
  if (!prev) return false;
  if (last === "요") return prev.jong === 0 && YO_VOWELS.has(prev.jung);
  if (last === "다") return prev.jong !== 0;
  if (last === "까") return prev.jong === JONG_RIEUL;
  return false;
}

/** "3." / "A." / "A.I." at the very end: probably a decimal / abbreviation cut by a pause. */
function danglingDot(t: string): boolean {
  return /\d\.$/.test(t) || /(?:^|[\s("'])(?:[A-Za-z]\.)+$/.test(t);
}

function isTerminalAt(text: string, i: number): boolean {
  const ch = text[i];
  if (!TERMINAL.includes(ch)) return false;
  if (ch === ".") {
    const prev = text[i - 1] ?? "";
    const next = text[i + 1] ?? "";
    // 3.5, 1.2배 — decimal point, not a sentence end
    if (/\d/.test(prev) && /\d/.test(next)) return false;
    // "매출이 3." at the end of a chunk: the rest of the number may arrive in the next chunk
    if (/\d/.test(prev) && i === text.length - 1) return false;
    // A.I., U.S. — single latin letter abbreviations (inside or at the end of the abbreviation)
    if (/[A-Za-z]/.test(prev) && !/[A-Za-z]/.test(text[i - 2] ?? "") && /[A-Za-z]/.test(next)) return false;
    if (/(?:^|[\s(])(?:[A-Za-z]\.){2,}$/.test(text.slice(0, i + 1))) return false;
    // "A." at the end of a chunk ("A." + "I. 기술로")
    if (i === text.length - 1 && /(?:^|[\s("'])[A-Za-z]\.$/.test(text)) return false;
  }
  return true;
}

/** True when an unpunctuated fragment already reads like a finished Korean sentence. */
function looksFinished(fragment: string): boolean {
  const t = fragment.trim();
  if (!t) return false;
  if (TERMINAL.includes(t[t.length - 1])) return !danglingDot(t);
  const lastWord = t.split(/\s+/).pop() ?? "";
  if (NOT_FINAL.some((w) => lastWord.endsWith(w))) return false;
  if (FINAL_ENDINGS.some((e) => lastWord.endsWith(e) && lastWord.length >= e.length + (e.length === 1 ? 1 : 0))) return true;
  return bareEndingFinal(lastWord);
}

/** Nouns that commonly take 하다 and get cut before it by a pause: "중요" + "합니다" → "중요합니다". */
const HADA_NOUN = /(?:중요|필요|불필요)$/;

/**
 * Join a carried (unfinished) fragment with the next STT chunk. Normally a space; no space when the
 * pause fell inside a token: a decimal ("3." + "5배"), an abbreviation ("A." + "I."), a 하다
 * predicate ("중요" + "합니다") or a detached case particle ("수요" + "가 …").
 */
function joinChunks(carry: string, chunk: string): string {
  const a = normalize(carry);
  const b = normalize(chunk);
  if (!a) return b;
  if (!b) return a;
  if (/\d\.$/.test(a) && /^\d/.test(b)) return a + b;
  if (/(?:^|[^A-Za-z])[A-Za-z]\.$/.test(a) && /^[A-Za-z]\./.test(b)) return a + b;
  if (HADA_NOUN.test(a) && /^(?:하|한|합|할|함|해|했|됩|된|될|되|돼)/.test(b)) return a + b;
  // a case particle can't stand alone: "시장 수요" + "가 늘고" → "시장 수요가 늘고" (not 이: 이 = "this")
  if (/[가-힣]$/.test(a) && /^(?:가|를|은|는|을|의|에서|에게|으로|로|와|과)(?:\s|[.,!?]|$)/.test(b)) return a + b;
  return `${a} ${b}`;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Split on terminal punctuation. Returns complete sentences and the unfinished remainder. */
function splitPunctuated(text: string): { complete: string[]; rest: string } {
  const complete: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    if (isTerminalAt(text, i)) {
      let j = i + 1;
      // swallow runs like "?!" "..." and closing quotes/brackets
      while (j < text.length && (TERMINAL.includes(text[j]) || CLOSERS.includes(text[j]))) j++;
      // sentence boundary only if followed by whitespace or end of text, and not by a quotative
      // particle continuing the same sentence: "좋습니다." 라고 / "왜요?" 하고
      const quoted = CLOSERS.includes(text[j - 1]) && /^\s*(?:라고|하고|이라고|고\s)/.test(text.slice(j));
      if ((j >= text.length || /\s/.test(text[j])) && !quoted) {
        const s = normalize(text.slice(start, j));
        if (s && !/^[.!?。？！…\s]+$/.test(s)) complete.push(s);
        else if (s && complete.length) complete[complete.length - 1] += s; // stray punctuation
        start = j;
        i = j;
        continue;
      }
      i = j;
      continue;
    }
    i++;
  }
  return { complete, rest: normalize(text.slice(start)) };
}

/** For text without punctuation: split after strong sentence-final endings followed by a space. */
function splitByEndings(text: string): { complete: string[]; rest: string } {
  const words = normalize(text).split(" ").filter(Boolean);
  const complete: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (STRONG_ENDINGS.some((e) => w.endsWith(e) && w.length >= Math.max(2, e.length))) {
      complete.push(cur.join(" "));
      cur = [];
    }
  }
  return { complete, rest: cur.join(" ") };
}

/**
 * Split text into complete Korean sentences + unfinished remainder.
 * `final: true` treats the whole input as closed (end of recording): the remainder becomes a sentence.
 */
function splitSentences(text: string, opts: { final?: boolean } = {}): { complete: string[]; rest: string } {
  const src = normalize(text);
  if (!src) return { complete: [], rest: "" };
  const { complete, rest: tail } = splitPunctuated(src);
  let rest = tail;
  // A long unpunctuated tail (recognizer dropped punctuation): fall back to ending-based splitting.
  if (rest && rest.length > 40) {
    const e = splitByEndings(rest);
    complete.push(...e.complete);
    rest = e.rest;
  }
  if (opts.final && rest) {
    complete.push(rest);
    rest = "";
  }
  return { complete, rest };
}

/**
 * Accumulates STT chunks and emits finished sentences, carrying partial sentences across chunks.
 *
 *   const a = new SentenceAssembler();
 *   a.push("안녕하세요. 저희 팀은")   // -> ["안녕하세요."], carry "저희 팀은"
 *   a.push("시뮬레이터를 소개합니다.") // -> ["저희 팀은 시뮬레이터를 소개합니다."]
 *   a.flush()                        // -> remaining carry as a sentence (or [])
 */
export class SentenceAssembler {
  private carry = "";

  /** Unfinished text waiting for the next chunk. */
  get pending(): string {
    return this.carry;
  }

  /**
   * Add a finalized STT chunk. `chunkClosed` = the chunk ended at a speech pause; an unpunctuated
   * tail that already ends with a sentence-final ending (…니다/…요/…까) is then accepted as complete.
   */
  push(chunk: string, chunkClosed = true): string[] {
    const merged = joinChunks(this.carry, chunk);
    const { complete, rest } = splitSentences(merged);
    if (chunkClosed && rest && looksFinished(rest)) {
      complete.push(rest);
      this.carry = "";
    } else {
      this.carry = rest;
    }
    return complete;
  }

  /** Preview of what is on screen while the speaker is still talking (carry + interim text). */
  preview(interim: string): { complete: string[]; rest: string } {
    return splitSentences(joinChunks(this.carry, interim));
  }

  /** Force out whatever is carried (stop / long silence). */
  flush(): string[] {
    const c = this.carry;
    this.carry = "";
    return c ? [c] : [];
  }

  reset() {
    this.carry = "";
  }
}
