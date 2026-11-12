// Cross-PoC contracts. Keep these stable: the real app (../app) will reuse them.

export type Temperament = "friendly" | "strict" | "aggressive"; // 친절함 | 빡셈 | 공격적
export const TEMPERAMENT_LABEL: Record<Temperament, string> = {
  friendly: "친절함",
  strict: "빡셈",
  aggressive: "공격적",
};

export type Gender = "male" | "female";

export interface JudgePersona {
  id: string;
  name: string; // Korean given name, e.g. "준호"
  temperament: Temperament;
  gender?: Gender;
  age?: number;
  imageUrl?: string; // served by /api/judge/image/<id>
}

/** One finalized STT sentence. t = seconds since the phase started. */
export interface TranscriptSentence {
  t: number;
  text: string;
  phase: "presentation" | "qa";
}

export interface QAItem {
  judge: Pick<JudgePersona, "id" | "name" | "temperament">;
  question: string;
  answer: string; // STT of the presenter's answer
  askedAt?: number;
}

/** Everything the report PoC needs after a full simulation run. */
export interface SessionRecord {
  id: string;
  situation: string; // 상황
  presentationMinutes: number;
  qaMinutes: number;
  presentationDocId?: string; // wiki doc id of 발표자료
  proposalDocId?: string; // wiki doc id of 제안자료
  judges: JudgePersona[];
  transcript: TranscriptSentence[];
  qa: QAItem[];
  createdAt: string;
}
