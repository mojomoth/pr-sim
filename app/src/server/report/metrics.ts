import "server-only";
// Deterministic speech metrics from STT sentences (pure, no I/O, no LLM).
// Only type imports → runs under plain Node type-stripping (report/tests/metrics.test.mjs) and in the browser.
import type { TranscriptSentence } from "../types";
import type { FillerExample, FillerHit, PauseHit, RepeatHit, SpeechMetrics } from "./types";

/** Default articulation rate (syllables / second) when there are too few sentences to estimate it. */
const ARTICULATION_SPS = 5.5;
const ARTICULATION_RANGE: [number, number] = [4, 9];
const LONG_PAUSE_SEC = 3;
const MAX_TIMELINE_MINUTES = 360;
const LONG_SENTENCE = 60; // syllables
/** Comfortable Korean presentation pace (syllables per minute). */
const RATE_OK: [number, number] = [240, 340];
const FILLER_OK_PER_MIN = 2;

const HESITATION_RE = /^(음+|어+|아+|에+|으+|흠+|엄+|음음|어어)$/;
const HABIT_WORDS = new Set([
  "이제",
  "약간",
  "그러니까",
  "그러니까요",
  "뭐랄까",
  "뭐랄까요",
  "뭐",
  "막",
  "좀",
  "진짜",
  "그냥",
  "일단",
  "사실",
  "사실은",
  "아무튼",
  "어쨌든",
  "솔직히",
]);
/** 그/저 are fillers only when hesitated: followed by punctuation, repeated, or followed by a word starting with the same syllable ("저 저희는"). */
const DEMONSTRATIVE_FILLERS = new Set(["그", "저"]);
const PUNCT_EDGE = /^[\s"'“”‘’()[\]{}<>«»·,.!?…~;:-]+|[\s"'“”‘’()[\]{}<>«»·,.!?…~;:-]+$/g;

const STOP_WORDS = new Set([
  "저희는", "저희가", "저희", "저희의", "있습니다", "합니다", "입니다", "그리고", "것", "수", "이", "그", "저", "있는", "하는", "있고", "하고",
  "됩니다", "같은", "이런", "그런", "통해", "대한", "위해", "있어서", "때문에", "말씀드리겠습니다", "정도", "약", "더", "또", "및", "등",
]);

/** Approximate spoken syllables: Hangul syllables + digits (≈1 each) + latin letters (≈0.7 each) + % (퍼센트 = 3). */
function countSyllables(text: string): number {
  let n = 0;
  let latin = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0xac00 && c <= 0xd7a3) n++;
    else if (c >= 48 && c <= 57) n++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) latin++;
    else if (ch === "%") n += 3;
  }
  return n + Math.round(latin * 0.7);
}

interface Token {
  raw: string;
  word: string; // punctuation stripped
  punctAfter: boolean;
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, word: raw.replace(PUNCT_EDGE, ""), punctAfter: /[,…~.]$|\.\.$/.test(raw) }))
    .filter((t) => t.word.length > 0);
}

function findFillers(text: string): { word: string; kind: FillerHit["kind"] }[] {
  const toks = tokenize(text);
  const out: { word: string; kind: FillerHit["kind"] }[] = [];
  toks.forEach((t, i) => {
    const next = toks[i + 1];
    if (HESITATION_RE.test(t.word)) out.push({ word: t.word.length > 1 && /^(음|어)+$/.test(t.word) ? t.word[0] : t.word, kind: "hesitation" });
    else if (DEMONSTRATIVE_FILLERS.has(t.word)) {
      const hesitated = t.punctAfter || !next || next.word === t.word || (next.word.length > 1 && next.word[0] === t.word) || HESITATION_RE.test(next.word);
      if (hesitated) out.push({ word: t.word, kind: "hesitation" });
    } else if (HABIT_WORDS.has(t.word)) out.push({ word: t.word.replace(/요$/, ""), kind: "habit" });
  });
  return out;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

interface MetricsOptions {
  presentationMinutes?: number;
  /** which phase to analyse (default "presentation"). No fallback: Q&A answers are never scored as the presentation —
   *  an empty presentation phase gives sentenceCount 0 (deliveryScore 0, excluded from the total by the report). */
  phase?: TranscriptSentence["phase"] | "all";
}

export function computeSpeechMetrics(transcript: TranscriptSentence[], opts: MetricsOptions = {}): SpeechMetrics {
  const phase = opts.phase ?? "presentation";
  const sents = (phase === "all" ? transcript : transcript.filter((s) => s.phase === phase)).filter((s) => s.text.trim()).sort((a, b) => a.t - b.t);
  const targetSeconds = Math.max(0, (opts.presentationMinutes ?? 0) * 60);

  const syl = sents.map((s) => countSyllables(s.text));
  const syllables = syl.reduce((a, b) => a + b, 0);
  const n = sents.length;
  // Articulation rate: sentence starts are the only timing we have, so estimate it from consecutive pairs
  // (syllables_i / (t_{i+1} - t_i)); pairs without a pause give the true rate → use the 75th percentile.
  const local = sents
    .slice(0, -1)
    .map((s, i) => syl[i] / Math.max(0.1, sents[i + 1].t - s.t))
    .sort((a, b) => a - b);
  const sps =
    local.length >= 3 ? Math.min(ARTICULATION_RANGE[1], Math.max(ARTICULATION_RANGE[0], local[Math.min(local.length - 1, Math.floor(local.length * 0.75))])) : ARTICULATION_SPS;
  const dur = (i: number) => syl[i] / sps;
  const start = n ? sents[0].t : 0;
  const lastEnd = n ? sents[n - 1].t + dur(n - 1) : 0;
  const spokenSeconds = n ? Math.max(1, lastEnd - start) : 0;

  // pauses: gap between sentence starts minus the estimated duration of the earlier sentence
  const pauseItems: PauseHit[] = [];
  let pauseTotal = 0;
  for (let i = 0; i + 1 < n; i++) {
    const gap = sents[i + 1].t - sents[i].t - dur(i);
    if (gap >= LONG_PAUSE_SEC) {
      pauseItems.push({ afterSentenceId: sents[i].id, t: round1(sents[i].t + dur(i)), seconds: round1(gap) });
      pauseTotal += gap;
    }
  }
  pauseItems.sort((a, b) => b.seconds - a.seconds);

  // speaking rate excludes long pauses (a long silence should not mask rushing)
  const minutes = Math.max(spokenSeconds - pauseTotal, n ? 1 : 0) / 60;
  const syllablesPerMinute = minutes > 0 ? Math.round(syllables / minutes) : 0;
  const sentencesPerMinute = minutes > 0 ? round1(n / minutes) : 0;
  const rateStatus: SpeechMetrics["rateStatus"] = n === 0 ? "ok" : syllablesPerMinute > RATE_OK[1] ? "fast" : syllablesPerMinute < RATE_OK[0] ? "slow" : "ok";

  const timeUsage = targetSeconds > 0 ? Math.round((spokenSeconds / targetSeconds) * 1000) / 1000 : 0;
  const timeStatus: SpeechMetrics["timeStatus"] = targetSeconds === 0 ? "ok" : timeUsage < 0.85 ? "short" : timeUsage > 1.02 ? "over" : "ok";

  // per-minute timeline (by sentence start, relative to first sentence)
  const buckets = new Map<number, number>();
  sents.forEach((s, i) => {
    const m = Math.floor((s.t - start) / 60);
    buckets.set(m, (buckets.get(m) ?? 0) + syl[i]);
  });
  // capped so a bogus timestamp can't allocate a huge array (schema already limits t to 6 h)
  const lastMinute = n ? Math.min(MAX_TIMELINE_MINUTES - 1, Math.floor((sents[n - 1].t - start) / 60)) : -1;
  const rateTimeline = Array.from({ length: lastMinute + 1 }, (_, m) => ({ minute: m + 1, syllables: buckets.get(m) ?? 0 }));

  // sentence length
  let maxIdx = -1;
  syl.forEach((v, i) => {
    if (maxIdx < 0 || v > syl[maxIdx]) maxIdx = i;
  });
  const avgSentenceSyllables = n ? round1(syllables / n) : 0;
  const longSentences = syl.filter((v) => v > LONG_SENTENCE).length;

  // fillers
  const counts = new Map<string, FillerHit>();
  const examples: FillerExample[] = [];
  let fillerTotal = 0;
  sents.forEach((s) => {
    const f = findFillers(s.text);
    if (!f.length) return;
    fillerTotal += f.length;
    for (const h of f) {
      const k = `${h.kind}:${h.word}`;
      const cur = counts.get(k) ?? { word: h.word, kind: h.kind, count: 0 };
      cur.count++;
      counts.set(k, cur);
    }
    examples.push({ sentenceId: s.id, t: s.t, text: s.text, words: f.map((h) => h.word) });
  });
  const byWord = [...counts.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  examples.sort((a, b) => b.words.length - a.words.length);

  // repetition
  const repetition: RepeatHit[] = [];
  const stutters = new Map<string, number>();
  const wordFreq = new Map<string, number>();
  const openers = new Map<string, number>();
  sents.forEach((s) => {
    const toks = tokenize(s.text);
    toks.forEach((t, i) => {
      if (i > 0 && toks[i - 1].word === t.word && !/^\d/.test(t.word)) stutters.set(`${t.word} ${t.word}`, (stutters.get(`${t.word} ${t.word}`) ?? 0) + 1);
      if (countSyllables(t.word) >= 2 && !STOP_WORDS.has(t.word) && !HABIT_WORDS.has(t.word) && !/\d/.test(t.word)) wordFreq.set(t.word, (wordFreq.get(t.word) ?? 0) + 1);
    });
    const first = toks.find((t) => !HESITATION_RE.test(t.word));
    if (first) openers.set(first.word, (openers.get(first.word) ?? 0) + 1);
  });
  for (const [text, count] of stutters) repetition.push({ kind: "stutter", text, count });
  const openerMin = Math.max(3, Math.ceil(n * 0.15));
  for (const [text, count] of openers) if (count >= openerMin && countSyllables(text) <= 5) repetition.push({ kind: "opener", text, count });
  const wordMin = Math.max(4, Math.ceil(n * 0.12));
  [...wordFreq.entries()]
    .filter(([, c]) => c >= wordMin)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([text, count]) => repetition.push({ kind: "word", text, count }));
  const kindOrder = { stutter: 0, opener: 1, word: 2 } as const;
  repetition.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.count - a.count);

  // deterministic delivery score
  const perMinute = spokenSeconds > 0 ? round1(fillerTotal / (spokenSeconds / 60)) : 0;
  const penalties: { reason: string; points: number }[] = [];
  const pen = (reason: string, points: number) => {
    const p = Math.round(points);
    if (p > 0) penalties.push({ reason, points: p });
  };
  if (n > 0) {
    if (syllablesPerMinute > RATE_OK[1]) pen(`말 속도 빠름 (${syllablesPerMinute}음절/분)`, Math.min(25, (syllablesPerMinute - RATE_OK[1]) / 4));
    if (syllablesPerMinute < RATE_OK[0]) pen(`말 속도 느림 (${syllablesPerMinute}음절/분)`, Math.min(20, (RATE_OK[0] - syllablesPerMinute) / 4));
    if (perMinute > FILLER_OK_PER_MIN) pen(`군말 많음 (분당 ${perMinute}회)`, Math.min(25, (perMinute - FILLER_OK_PER_MIN) * 4));
    if (targetSeconds > 0 && timeUsage < 0.85) pen(`시간 미달 (${Math.round(timeUsage * 100)}%)`, Math.min(20, (0.85 - timeUsage) * 60));
    if (targetSeconds > 0 && timeUsage > 1.02) pen(`시간 초과 (${Math.round(timeUsage * 100)}%)`, Math.min(25, (timeUsage - 1.02) * 100));
    if (pauseItems.length) pen(`긴 침묵 ${pauseItems.length}회`, Math.min(10, pauseItems.length * 2));
    if (avgSentenceSyllables > 45) pen(`긴 문장 (평균 ${avgSentenceSyllables}음절)`, Math.min(10, (avgSentenceSyllables - 45) / 2));
    const st = [...stutters.values()].reduce((a, b) => a + b, 0);
    if (st) pen(`말 더듬기·반복 ${st}회`, Math.min(5, st));
  }
  const deliveryScore = n === 0 ? 0 : clamp(Math.round(100 - penalties.reduce((a, p) => a + p.points, 0)));

  return {
    sentenceCount: n,
    syllables,
    articulationSps: round1(sps),
    spokenSeconds: round1(spokenSeconds),
    targetSeconds,
    timeUsage,
    timeStatus,
    syllablesPerMinute,
    sentencesPerMinute,
    rateStatus,
    rateTimeline,
    avgSentenceSyllables,
    maxSentenceSyllables: maxIdx >= 0 ? syl[maxIdx] : 0,
    maxSentence: maxIdx >= 0 ? { sentenceId: sents[maxIdx].id, text: sents[maxIdx].text } : null,
    longSentences,
    fillers: {
      total: fillerTotal,
      perMinute,
      per100Syllables: syllables > 0 ? round1((fillerTotal / syllables) * 100) : 0,
      byWord,
      examples: examples.slice(0, 6),
    },
    repetition,
    pauses: { threshold: LONG_PAUSE_SEC, count: pauseItems.length, longest: pauseItems[0]?.seconds ?? 0, totalSeconds: round1(pauseTotal), items: pauseItems.slice(0, 8) },
    deliveryScore,
    deliveryPenalties: penalties,
  };
}

/** Filler count of an arbitrary utterance (used for Q&A answers). */
export function countFillers(text: string): number {
  return findFillers(text).length;
}
