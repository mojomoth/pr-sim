import "server-only";
import type { Gender, Temperament } from "../types";

// Persona -> Gemini TTS voice + speaking-style prompt (OpenAI gets the same style as `instructions`).

export interface VoicePersona {
  gender: Gender;
  age: number; // 20–70
  temperament: Temperament;
}

type AgeBand = "young" | "senior";
const ageBand = (age: number): AgeBand => (age < 40 ? "young" : "senior");

/**
 * Gemini prebuilt voices (30 total; character labels from the Gemini speech-generation docs).
 * We pick one per gender × age band × temperament so the 12 combinations sound different even
 * before the style prompt is applied. Every name below was verified against the TTS model
 * (see README "Verification").
 */
const VOICE_TABLE: Record<Gender, Record<Temperament, Record<AgeBand, { voice: string; character: string }>>> = {
  male: {
    friendly: { young: { voice: "Achird", character: "Friendly" }, senior: { voice: "Sadaltager", character: "Knowledgeable" } },
    strict: { young: { voice: "Iapetus", character: "Clear" }, senior: { voice: "Schedar", character: "Even" } },
    aggressive: { young: { voice: "Fenrir", character: "Excitable" }, senior: { voice: "Algenib", character: "Gravelly" } },
  },
  female: {
    friendly: { young: { voice: "Sulafat", character: "Warm" }, senior: { voice: "Vindemiatrix", character: "Gentle" } },
    strict: { young: { voice: "Erinome", character: "Clear" }, senior: { voice: "Gacrux", character: "Mature" } },
    aggressive: { young: { voice: "Kore", character: "Firm" }, senior: { voice: "Pulcherrima", character: "Forward" } },
  },
};


const TEMPERAMENT_STYLE: Record<Temperament, string> = {
  friendly: "warm, gentle and encouraging; moderate, relaxed pace; soft smile in the voice; reassuring rising intonation on questions",
  strict: "crisp, dry and precise; slightly fast, businesslike pace; neutral emotion; clipped sentence endings; every word clearly articulated",
  aggressive: "pressing, firm and skeptical; sharp emphasis on key words; short pauses before the challenge; confident and intense but still professional and polite (no shouting, no insults)",
};

/**
 * Age → performance direction, continuous per year (not per band): the exact age, a timbre/pitch
 * descriptor in ~8-year steps and a pace offset that goes from ≈13% quicker at 20 to ≈13% slower at 70.
 * The prebuilt voice itself only switches at 40 (VOICE_TABLE), so this is what makes 25 vs 35 differ.
 */
function ageStyle(age: number, gender: Gender): string {
  const a = Math.round(Math.min(70, Math.max(20, age)));
  const who = gender === "male" ? "man" : "woman";
  const timbre =
    a <= 27 ? "youthful, bright timbre with a slightly higher pitch" :
    a <= 34 ? "clear, energetic young-adult voice, mid-high pitch" :
    a <= 44 ? "confident adult voice, natural mid pitch" :
    a <= 54 ? "settled, mature voice, slightly lower mid pitch" :
    a <= 62 ? "seasoned, lower-pitched voice with a little gravel" :
    "deep, low, weathered voice of an elder";
  const pct = Math.round((45 - a) / 2); // +13 … -13
  const pace = pct >= 2 ? `about ${pct}% quicker than an average speaker` : pct <= -2 ? `about ${-pct}% slower than an average speaker, unhurried and deliberate` : "average, natural pace";
  return `a ${a}-year-old Korean ${who}: ${timbre}; pace: ${pace}`;
}

/** Full style instruction sent to the TTS model (English directions work best; text stays Korean). */
export function styleFor(p: VoicePersona): string {
  return `Voice: ${ageStyle(p.age, p.gender)}, acting as a judge on a startup pitch review panel. Tone: ${TEMPERAMENT_STYLE[p.temperament]}. Speak natural, standard Seoul Korean.`;
}

export function resolveVoice(p: VoicePersona): { voice: string; character: string; style: string } {
  const v = VOICE_TABLE[p.gender][p.temperament][ageBand(p.age)];
  return { ...v, style: styleFor(p) };
}

/**
 * Prompt in the "director's notes" layout from the Gemini speech-generation prompting guide:
 * profile/scene/notes are performance directions, only the TRANSCRIPT section is spoken.
 * (A flat "style: … TEXT: …" prompt made gemini-3.8-flash-lite-tts read the directions aloud.)
 */
export function ttsPrompt(text: string, style: string): string {
  return [
    "# AUDIO PROFILE: Pitch review panel judge",
    "## THE SCENE: A quiet Korean startup pitch competition room. The judge asks the presenter a question.",
    "### DIRECTOR'S NOTES",
    style,
    "Perform ONLY the transcript below, in Korean. Never read these notes or headings aloud.",
    "#### TRANSCRIPT",
    text.trim(),
  ].join("\n");
}

