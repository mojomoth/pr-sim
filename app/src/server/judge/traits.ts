import "server-only";
import type { Gender, Temperament } from "../types";
import type { RollAvoid } from "./types";

// Randomization + prompt building for judge portraits.
// The ONLY user input is a Temperament; everything else is rolled here.

export interface JudgeTraits {
  gender: Gender;
  age: number; // 32–64
  surname: string;
  givenName: string;
  hair: string;
  facialHair: string | null;
  glasses: string | null;
  attire: string;
  attireStyle: "formal" | "smart-casual";
  setting: string;
  lighting: string;
  demeanor: string;
}

type Rng = () => number;
const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const chance = (rng: Rng, p: number) => rng() < p;
const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

// Weighted roughly by real-world frequency (김/이/박 most common).
const SURNAMES = ["김", "김", "김", "이", "이", "이", "박", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "송", "안", "유", "홍"] as const;

// Given names by gender and generation (older judges get era-appropriate names).
const NAMES: Record<Gender, { older: readonly string[]; younger: readonly string[] }> = {
  male: {
    older: ["상철", "영훈", "정호", "동욱", "성수", "기범", "태식", "종민", "재석", "병철", "형준", "광수", "명수", "준식"],
    younger: ["준호", "성민", "재현", "민수", "정우", "현석", "승우", "진혁", "용준", "동현", "태윤", "지훈", "상우", "민재"],
  },
  female: {
    older: ["미경", "선희", "은정", "경아", "영숙", "정희", "혜숙", "미숙", "순영", "명희", "현숙", "은주", "정애", "경희"],
    younger: ["지영", "수진", "혜원", "서연", "윤희", "소영", "현주", "지혜", "민정", "유진", "보람", "은지", "나연", "다은"],
  },
};

const HAIR_COLOR_YOUNG = ["black", "very dark brown", "natural black"] as const;

function rollHair(rng: Rng, gender: Gender, age: number): string {
  const color = pick(rng, HAIR_COLOR_YOUNG);
  const graying =
    age >= 56 ? pick(rng, ["mostly gray", "salt-and-pepper", "silver-gray"]) : age >= 47 && chance(rng, 0.55) ? "salt-and-pepper" : null;
  const c = graying ?? color;
  if (gender === "male") {
    const styles = [
      `short, neatly side-parted ${c} hair`,
      `short cropped ${c} hair`,
      `${c} hair, slightly longer and swept back`,
      `a neat ${c} two-block haircut`,
      `short ${c} hair combed upward`,
      ...(age >= 45 ? [`short ${c} hair with a slightly receding hairline`, `thinning short ${c} hair, neatly combed`] : []),
    ];
    return pick(rng, styles);
  }
  const styles = [
    `shoulder-length straight ${c} hair`,
    `a chin-length ${c} bob`,
    `${c} hair tied back in a low ponytail`,
    `a short layered ${c} haircut`,
    `long ${c} hair tucked behind the ears`,
    `${c} hair pulled back into a neat low bun`,
    ...(age >= 40 ? [`soft-permed shoulder-length ${c} hair`, `a short, neatly styled ${c} perm`] : []),
  ];
  return pick(rng, styles);
}

const GLASSES = [
  "thin gold metal-rimmed glasses",
  "black rectangular-framed glasses",
  "tortoiseshell round glasses",
  "rimless glasses",
  "thin dark-gray half-rim glasses",
] as const;

const SUIT_COLORS = ["navy", "charcoal", "dark gray", "black", "deep blue"] as const;
const CASUAL_COLORS = ["beige", "camel", "olive", "light gray", "navy", "cream", "charcoal", "dusty blue"] as const;

function rollAttire(rng: Rng, gender: Gender): { attire: string; attireStyle: JudgeTraits["attireStyle"] } {
  const formal = chance(rng, 0.6);
  if (formal) {
    const suit = pick(rng, SUIT_COLORS);
    const options =
      gender === "male"
        ? [
            `a ${suit} business suit, white dress shirt and a muted ${pick(rng, ["navy", "burgundy", "gray", "dark green"])} tie`,
            `a ${suit} business suit with a light-blue dress shirt, no tie, top button open`,
            `a ${suit} suit jacket over a crisp white shirt, no tie`,
          ]
        : [
            `a tailored ${suit} blazer over a white silk blouse`,
            `a ${suit} pantsuit jacket with a simple ivory round-neck top`,
            `a structured ${suit} blazer over a light-gray blouse, small pearl stud earrings`,
          ];
    return { attire: pick(rng, options), attireStyle: "formal" };
  }
  const col = pick(rng, CASUAL_COLORS);
  const options =
    gender === "male"
      ? [
          `a ${col} fine-knit crewneck sweater over a collared shirt`,
          `an unstructured ${col} casual blazer over a plain white t-shirt`,
          `a ${col} open-collar oxford shirt`,
          `a thin ${col} turtleneck`,
        ]
      : [
          `a ${col} fine-knit cardigan over a simple blouse`,
          `a ${col} turtleneck sweater with small stud earrings`,
          `a relaxed ${col} blazer over a white t-shirt`,
          `a ${col} collarless jacket over a plain top`,
        ];
  return { attire: pick(rng, options), attireStyle: "smart-casual" };
}

const SETTINGS = [
  "a modern office meeting room with a large window, softly blurred",
  "a seamless light-gray photo studio backdrop",
  "a muted warm-gray studio backdrop",
  "a conference room with light wooden wall panels, softly blurred",
  "a bright minimalist office with white walls and a plant far in the background, softly blurred",
  "a corporate boardroom with glass walls, heavily blurred",
] as const;

const LIGHTING = [
  "soft diffused daylight from a large side window",
  "even overcast daylight, soft and natural",
  "a soft key light from front-left with gentle fill, like a corporate headshot",
  "gentle late-afternoon window light, subtle and natural",
  "soft natural light from the front with mild falloff on one side",
] as const;

// Temperament → subtle, realistic demeanor (DESIGN.md: no exaggerated expressions).
const DEMEANOR: Record<Temperament, readonly string[]> = {
  friendly: [
    "a warm, gentle closed-mouth smile that reaches the eyes, relaxed brow, approachable and encouraging presence",
    "a soft friendly smile with slightly crinkled eyes and relaxed shoulders, open and kind",
    "a pleasant easy smile with a small hint of teeth, attentive and welcoming gaze, relaxed posture",
  ],
  strict: [
    "a composed neutral expression with lips gently closed, attentive evaluating gaze, upright posture, professional and reserved",
    "a serious but calm expression, focused eyes that seem to be carefully weighing every word, no smile",
    "a reserved poker face, steady analytical look, meticulous and exacting impression, perfectly still",
  ],
  aggressive: [
    "an intense, direct gaze straight into the lens, firm set jaw, brows slightly lowered, mouth set in a flat line, no smile; skeptical and challenging but controlled, realistic and not angry",
    "a sharp, piercing stare with lips pressed into a thin line and the chin slightly lowered, looking up a little from under the brows; a tough, demanding interviewer presence, subtle and natural",
    "a skeptical, unimpressed look with both eyes evenly and slightly narrowed, a firm unsmiling mouth and the head tilted very slightly down; confident and confrontational yet restrained",
  ],
};

/** Roll a full set of random traits for one judge. */
export function rollTraits(temperament: Temperament, avoid: RollAvoid = {}, rng: Rng = Math.random): JudgeTraits {
  // Gender: balance against the panel so far.
  const g = avoid.genders ?? [];
  const males = g.filter((x) => x === "male").length;
  const females = g.length - males;
  const pMale = males === females ? 0.5 : males > females ? 0.25 : 0.75;
  const gender: Gender = rng() < pMale ? "male" : "female";

  // Age: 32–64, try to keep ≥6 years away from panel ages.
  let age = randInt(rng, 32, 64);
  for (let i = 0; i < 8 && (avoid.ages ?? []).some((a) => Math.abs(a - age) < 6); i++) age = randInt(rng, 32, 64);

  const pool = age >= 50 ? NAMES[gender].older : NAMES[gender].younger;
  const taken = new Set(avoid.names ?? []);
  const free = pool.filter((n) => !taken.has(n));
  const givenName = pick(rng, free.length ? free : pool);

  const takenSur = new Set(avoid.surnames ?? []);
  const freeSur = SURNAMES.filter((s) => !takenSur.has(s));
  const surname = pick(rng, freeSur.length ? freeSur : SURNAMES);

  const { attire, attireStyle } = rollAttire(rng, gender);
  return {
    gender,
    age,
    surname,
    givenName,
    hair: rollHair(rng, gender, age),
    facialHair: gender === "male" && chance(rng, 0.2) ? pick(rng, ["light, neatly trimmed stubble", "a short, neatly groomed beard"]) : null,
    glasses: chance(rng, 0.35) ? pick(rng, GLASSES) : null,
    attire,
    attireStyle,
    setting: pick(rng, SETTINGS),
    lighting: pick(rng, LIGHTING),
    demeanor: pick(rng, DEMEANOR[temperament]),
  };
}

function ageWords(age: number, pron: string) {
  const decade = Math.floor(age / 10) * 10;
  const pos = age % 10 <= 3 ? "early" : age % 10 <= 6 ? "mid" : "late";
  return `in ${pron} ${pos} ${decade}s (about ${age} years old)`;
}

/** Build the image prompt. Framing is fixed so portraits tile consistently. */
export function buildPrompt(t: JudgeTraits): string {
  const person = t.gender === "male" ? "man" : "woman";
  const pron = t.gender === "male" ? "his" : "her";
  const ageLine = ageWords(t.age, pron);
  const lines = [
    `A full-color, photorealistic, natural-light headshot photograph of a fictional Korean ${person} ${ageLine}, a judge on a business pitch evaluation panel.`,
    `Appearance: ${t.hair}${t.facialHair ? `, ${t.facialHair}` : ""}${t.glasses ? `, wearing ${t.glasses}` : ", no glasses"}; dressed in ${t.attire}. ${pron[0].toUpperCase() + pron.slice(1)} face should look genuinely ${t.age} years old — not older, not younger.`,
    `Expression and demeanor: ${t.demeanor}.`,
    `Framing (keep identical across a series): square head-and-shoulders portrait, camera at eye level, subject centered and facing the camera squarely, both eyes open, natural and symmetrical, looking directly into the lens and placed about 40% from the top edge. The top of the head sits a little below the top edge; shoulders and upper chest fill the bottom of the frame; the face takes up about 40% of the image height. 85mm lens at f/2.8, shallow depth of field.`,
    `Lighting: ${t.lighting}.`,
    `Background: ${t.setting}, neutral muted colors, nothing distracting.`,
    `Style: a real candid-quality photograph, natural skin texture with visible pores, no retouching, no beauty filter, no glamour makeup. Natural true-to-life color with realistic skin tones — not black-and-white, not monochrome, not desaturated or sepia. Not an illustration, not a 3D render, not CGI, not a stock-photo grin.`,
    `Strictly no text, letters, numbers, logos, name tags, badges, watermarks, borders or frames anywhere in the image.`,
  ];
  return lines.join("\n");
}

/** Short hint for TTS voice selection (gender/age/temperament). */
export function voiceHint(t: Pick<JudgeTraits, "gender" | "age">, temperament: Temperament): string {
  const g = t.gender === "male" ? "남성" : "여성";
  const tone = temperament === "friendly" ? "따뜻하고 부드러운" : temperament === "strict" ? "차분하고 단호한" : "날카롭고 압박감 있는";
  return `${Math.floor(t.age / 10) * 10}대 ${g}, ${tone} 목소리`;
}
