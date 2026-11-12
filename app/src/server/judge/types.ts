// Public types of the judge module (client-safe: no server imports).
import type { Gender, JudgePersona } from "../types";

/** What to avoid when rolling judges: the rest of the panel (names, surnames, genders, ages already taken). */
export interface RollAvoid {
  names?: string[]; // given names already taken
  surnames?: string[]; // surnames already taken ("황 심사위원님" must be unambiguous in Q&A/TTS)
  genders?: Gender[]; // genders already on the panel
  ages?: number[]; // ages already on the panel
}

/** One generated judge. The 256px thumbnail is made by the client (createImageBitmap + canvas). */
export interface JudgeOut extends JudgePersona {
  gender: Gender;
  age: number;
  fullName: string; // e.g. "김준호"
  voiceHint: string; // e.g. "40대 남성, 차분하고 단호한 목소리"
  image: { mime: string; base64: string }; // 1024px, full color: image/webp (gpt-image-2) or image/png|jpeg (Gemini fallback)
}

/** POST /api/judges NDJSON events. */
export type JudgeEvent =
  | { type: "judge"; slot: number; judge: JudgeOut; model: string }
  | { type: "error"; slot: number; code: string; message: string }
  | { type: "done"; ms: number };
