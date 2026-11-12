// Isomorphic types for the judge PoC (safe to import from client components).
import type { JudgePersona, Temperament } from "@/lib/types";
import type { JudgeTraits } from "./traits";

export type ImageQuality = "low" | "medium" | "high";
export const QUALITIES: readonly ImageQuality[] = ["low", "medium", "high"];
export const QUALITY_LABEL: Record<ImageQuality, { label: string; eta: string }> = {
  low: { label: "빠름", eta: "약 10–15초" },
  medium: { label: "보통", eta: "약 25–35초" },
  high: { label: "고화질", eta: "약 60–90초" },
};

/** Persisted judge record (.data/judge/<id>.json). Superset of the shared JudgePersona contract. */
export interface JudgeRecord extends JudgePersona {
  gender: NonNullable<JudgePersona["gender"]>;
  age: number;
  imageUrl: string; // /api/judge/image/<id>
  thumbUrl: string; // /api/judge/image/<id>?size=thumb (256px)  — also ?size=card (512px, derived lazily)
  surname: string;
  fullName: string; // e.g. "김준호"
  voiceHint: string; // for TTS voice selection, e.g. "40대 남성, 차분하고 단호한 목소리"
  traits: JudgeTraits;
  prompt: string;
  ms: number; // OpenAI call latency
  totalMs: number; // incl. thumbnail + disk writes
  model: string;
  quality: ImageQuality;
  size: string;
  bytes: number;
  createdAt: string;
}

export type { Temperament };

/** Responsive srcset for a judge photo: 256 thumb / 512 card / 1024 full. */
export const judgeSrcSet = (j: Pick<JudgeRecord, "imageUrl">) =>
  `${j.imageUrl}?size=thumb 256w, ${j.imageUrl}?size=card 512w, ${j.imageUrl} 1024w`;
