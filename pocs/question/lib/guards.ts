// Server-side guards on the judge model's follow-up output (pure, isomorphic — unit-tested in tests/guards.ts).
import type { Temperament } from "@/lib/types";
import { numberTokens, similarity } from "./text";
import type { GeneratedQuestion } from "./types";

/** Spoken remark (said right before the next question) — max characters. */
export const REMARK_MAX = 40;

const DEFAULT_REMARK: Record<Temperament, string> = { friendly: "네, 잘 들었습니다.", strict: "알겠습니다.", aggressive: "그건 답이 안 됩니다." };

/**
 * Keep the spoken remark short: whole sentences up to REMARK_MAX chars. If even the first sentence is
 * too long, fall back to the persona's stock reaction (cutting a sentence mid-way sounds broken in TTS).
 */
export function clampRemark(remark: string, t: Temperament): string {
  const s = remark.replace(/\s+/g, " ").trim();
  if (!s) return DEFAULT_REMARK[t];
  if (s.length <= REMARK_MAX) return s;
  const sentences = s.match(/[^.?!。]+[.?!。]+|[^.?!。]+$/g)?.map((x) => x.trim()) ?? [s];
  let out = "";
  for (const x of sentences) {
    const next = out ? `${out} ${x}` : x;
    if (next.length > REMARK_MAX) break;
    out = next;
  }
  return out || DEFAULT_REMARK[t];
}

/**
 * Does a proposed follow-up really re-ask one of the still-pending (not yet asked) questions?
 * Signals: question text / target claim similarity, or ≥2 number tokens that are NEW to this topic
 * (not in the original question, its evidence or the answers) but occur in the pending question.
 */
export function duplicateOfPending(
  f: { question: string; targetClaim: string },
  topicText: string,
  pending: GeneratedQuestion[],
): GeneratedQuestion | null {
  const topicNums = new Set(numberTokens(topicText));
  const newNums = numberTokens(`${f.question} ${f.targetClaim}`).filter((n) => !topicNums.has(n));
  for (const p of pending) {
    if (similarity(f.question, p.question) > 0.45) return p;
    if (similarity(f.targetClaim, p.targetClaim) > 0.6) return p;
    if (newNums.length) {
      const pn = new Set(numberTokens(`${p.question} ${p.targetClaim}`));
      if (newNums.filter((n) => pn.has(n)).length >= Math.min(2, newNums.length)) return p;
    }
  }
  return null;
}

