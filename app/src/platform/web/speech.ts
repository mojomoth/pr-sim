"use client";
// Browser text-to-speech (Web Speech API): the fallback voice when /api/tts can't make audio
// (provider quota/outage, network). Lower quality than the server voices, so callers should say so.
// A Capacitor build can swap this for a native TTS plugin behind the same platform.audio.speak().
import type { Playback } from "./playWav";

export interface SpeechVoice {
  gender: "male" | "female";
  age: number;
  temperament: "friendly" | "strict" | "aggressive";
}

// Voice-name heuristics (macOS/iOS, Chrome "Google", Edge/Windows "Microsoft", Android).
const FEMALE = /yuna|유나|sora|소라|suhyun|수현|heami|sunhi|seoyeon|jimin|yujin|flo|grandma|sandy|shelley|female|여성|여자|google/i;
const NOVELTY = /eddy|reed|rocko|grandpa|flo|grandma|sandy|shelley/i;
const MALE = /minsu|민수|injoon|hyunsu|bongjin|gookmin|jinho|eddy|reed|rocko|grandpa|male|남성|남자/i;

// Quality by name: downloaded Premium/Enhanced (macOS/iOS "향상됨"), Siri/Natural/Neural, Google; on-device first
// (works offline, which matters because this is the fallback when the network is down, and has no ~15s cutoff).
const QUALITY: [RegExp, number][] = [[/premium|프리미엄|고품질/i, 3], [/enhanced|향상/i, 2], [/siri|natural|neural/i, 1], [/google/i, 1]];
const quality = (v: { name: string; localService?: boolean }) =>
  QUALITY.reduce((q, [re, w]) => q + (re.test(v.name) ? w : 0), v.localService ? 2 : 0) - (NOVELTY.test(v.name) ? 10 : 0);

/**
 * Best ko-KR voice for the gender (null = let the browser pick). The macOS novelty set (Eddy, Flo, …) sounds
 * robotic, so a standard voice of the other gender (pitch-shifted by prosody, matched=false) beats it.
 * `seed` spreads judges over equally good voices so two judges don't share one when there is a choice.
 */
export function pickVoice<V extends { name: string; lang: string; localService?: boolean }>(voices: V[], gender: SpeechVoice["gender"], seed = 0): { voice: V | null; matched: boolean } {
  const ko = voices.filter((v) => /^ko([-_]|$)/i.test(v.lang));
  const want = gender === "female" ? FEMALE : MALE;
  const other = gender === "female" ? MALE : FEMALE;
  // MALE also matches "female", so a male match must not look female.
  const match = ko.filter((v) => want.test(v.name) && !(gender === "male" && FEMALE.test(v.name)));
  const pick = (list: V[]) => {
    const ranked = [...list].sort((a, b) => quality(b) - quality(a));
    const top = ranked.filter((v) => quality(v) === quality(ranked[0]));
    return top.length ? top[Math.abs(seed) % top.length] : null;
  };
  const standard = (list: V[]) => list.filter((v) => !NOVELTY.test(v.name));
  if (standard(match).length) return { voice: pick(standard(match)), matched: true };
  const rest = standard(ko.filter((v) => !other.test(v.name)));
  const any = rest.length ? rest : standard(ko);
  if (any.length) return { voice: pick(any), matched: false };
  return match.length ? { voice: pick(match), matched: true } : { voice: pick(ko), matched: false };
}

/** Stable small number per judge persona (no id on SpeechVoice): judges usually differ in age or temperament. */
export const voiceSeed = (p: SpeechVoice) => p.age * 3 + ["friendly", "strict", "aggressive"].indexOf(p.temperament);

/** rate/pitch per persona: friendly slower + warmer, strict neutral, aggressive faster + lower; older a bit slower/lower. */
export function prosody(p: SpeechVoice, genderMatched: boolean): { rate: number; pitch: number } {
  const t = { friendly: { rate: 0.92, pitch: 1.08 }, strict: { rate: 1, pitch: 1 }, aggressive: { rate: 1.12, pitch: 0.88 } }[p.temperament];
  const age = Math.max(20, Math.min(70, p.age));
  let rate = t.rate * (1 - (age - 40) * 0.003);
  let pitch = t.pitch * (1 - (age - 40) * 0.004);
  // No voice of the right gender: shift pitch so the judge still sounds roughly right (male: lower and a bit slower).
  if (!genderMatched) {
    pitch *= p.gender === "male" ? 0.75 : 1.2;
    if (p.gender === "male") rate *= 0.95;
  }
  rate = Math.round(Math.max(0.6, Math.min(1.5, rate)) * 100) / 100;
  pitch = Math.round(Math.max(0.3, Math.min(1.8, pitch)) * 100) / 100;
  return { rate, pitch };
}

/** Split long text into sentences: Chrome's network voices cut off utterances after ~15s. */
export function chunks(text: string, max = 160): string[] {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.?!。？！]+[.?!。？！]*\s*/g) ?? [];
  const out: string[] = [];
  for (const p of parts) {
    const last = out.length - 1;
    if (last >= 0 && out[last].length + p.length <= max) out[last] += p;
    else out.push(p);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Voices load asynchronously in Chrome: wait (briefly) for the first non-empty list. */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(speechSynthesis.getVoices()), 1000);
    speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(t);
        resolve(speechSynthesis.getVoices());
      },
      { once: true },
    );
  });
}

let current: Playback | null = null;

export function stopSpeech() {
  current?.stop();
  current = null;
  if (speechSupported()) speechSynthesis.cancel();
}

/** iOS needs the first utterance inside a tap: call from the same gesture as unlockAudio(). */
let unlocked = false;
export function unlockSpeech() {
  if (unlocked || !speechSupported()) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}

/** Speak `text` with a ko-KR browser voice shaped by the judge persona. Same contract as playWav(). */
export function speak(text: string, persona: SpeechVoice, opts: { onEnd?: () => void } = {}): Playback {
  stopSpeech();
  let settled = false;
  let finish!: () => void;
  let fail!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    finish = res;
    fail = rej;
  });
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const settle = (err?: unknown) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    if (current === pb) current = null;
    if (err) fail(err);
    else {
      opts.onEnd?.();
      finish();
    }
  };
  const pb: Playback = {
    done,
    stop: () => {
      if (settled) return;
      settle();
      speechSynthesis.cancel();
    },
  };
  if (!speechSupported()) {
    settle(new Error("이 브라우저에서는 질문을 소리로 읽어 줄 수 없어요."));
    return pb;
  }
  current = pb;
  const parts = chunks(text);
  if (!parts.length) {
    settle();
    return pb;
  }
  void loadVoices().then((voices) => {
    if (settled) return;
    const { voice, matched } = pickVoice(voices, persona.gender, voiceSeed(persona));
    const { rate, pitch } = prosody(persona, matched);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang ?? "ko-KR";
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = pitch;
      if (i === parts.length - 1) u.onend = () => settle();
      // "interrupted"/"canceled" = stop()/stopAll(); anything else is a real failure.
      u.onerror = (e) => settle(e.error === "interrupted" || e.error === "canceled" ? undefined : new Error("질문을 소리로 읽지 못했어요."));
      speechSynthesis.speak(u);
    });
    // Some engines never fire onend (Chrome bug): give up after a generous estimate.
    watchdog = setTimeout(() => settle(), 5_000 + (text.length * 250) / rate);
  });
  return pb;
}
