// Shared test fixtures for the PR-SIM PoCs (server-side helpers + public URLs).
// Usage (server code / route handlers):
//   import { FIXTURES, fixturePath, loadSampleSession, readFixture } from "@/fixtures/lib";
//   const pdf = await readFixture("presentationPdf");           // Buffer
//   const session = await loadSampleSession();                  // validated SessionRecord
// Browser code: use FIXTURES[x].url (served from public/fixtures by Next).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SessionRecord } from "@/lib/types";
import { parseSessionRecord } from "./session";

export { parseSessionRecord, SessionRecordSchema } from "./session";

export const FIXTURES = {
  presentationPdf: { file: "presentation.pdf", url: "/fixtures/presentation.pdf", desc: "발표자료 — 12장 16:9 피치덱 (1280x720)" },
  proposalPdf: { file: "proposal.pdf", url: "/fixtures/proposal.pdf", desc: "제안자료 — 58쪽 A4 사업계획서" },
  script: { file: "presentation-script.txt", url: "/fixtures/presentation-script.txt", desc: "5분 발표 대본, 한 줄에 한 문장 (54문장)" },
  speechWav: { file: "audio/speech-ko.wav", url: "/fixtures/audio/speech-ko.wav", desc: "대본 첫 8문장 음성, 24kHz mono, 0.8초 간격" },
  speechWav16k: { file: "audio/speech-ko-16k.wav", url: "/fixtures/audio/speech-ko-16k.wav", desc: "위 음성 16kHz mono (Chrome 가짜 마이크용)" },
  speechTiming: { file: "audio/speech-ko.timing.json", url: "/fixtures/audio/speech-ko.timing.json", desc: "speech-ko.wav 문장별 시작/끝(초)" },
  answerWav: { file: "audio/answer-ko.wav", url: "/fixtures/audio/answer-ko.wav", desc: "질의 답변 음성 (~17초), 24kHz mono" },
  answerWav16k: { file: "audio/answer-ko-16k.wav", url: "/fixtures/audio/answer-ko-16k.wav", desc: "위 답변 16kHz mono" },
  answerText: { file: "audio/answer-ko.txt", url: "/fixtures/audio/answer-ko.txt", desc: "답변 음성의 질문/정답 텍스트" },
  sampleSession: { file: "sample-session.json", url: "/fixtures/sample-session.json", desc: "SessionRecord 샘플 (전사 46문장, 심사위원 3, QA 4)" },
} as const;

export type FixtureKey = keyof typeof FIXTURES;

/** Absolute path of a fixture on disk (server only). */
export function fixturePath(key: FixtureKey): string {
  return path.join(process.cwd(), "fixtures", FIXTURES[key].file);
}

export function readFixture(key: FixtureKey): Promise<Buffer> {
  return readFile(fixturePath(key));
}

export async function loadSampleSession(): Promise<SessionRecord> {
  return parseSessionRecord(JSON.parse(await readFile(fixturePath("sampleSession"), "utf8")));
}

/** Deliberate deck-vs-proposal weak points, for judge-question / report detection tests. */
export const INTENDED_WEAK_POINTS = [
  {
    id: "unit-cost",
    title: "단위 원가 불일치",
    deck: "발표덱 6·9장: 세트당 원가 118원, 매출총이익률 28%",
    proposal: "제안서 9장 원가 구조(및 요약 등): 세트당 원가 142원, 매출총이익률 약 14%",
  },
  {
    id: "som",
    title: "SOM 불일치",
    deck: "발표덱 5장: SOM 340억 원 (SAM의 5%)",
    proposal: "제안서 5장 시장 분석(및 요약): SOM 210억 원 (SAM의 약 3.1%)",
  },
  {
    id: "growth",
    title: "근거 없는 성장 가정 + 생산능력 미검증",
    deck: "발표덱 9장: 2026E 2.7억 → 2027E 32억(약 12배) → 2028E 96억, 근거는 'LOI 3건 전환 + 월 신규 8곳'뿐",
    proposal:
      "제안서 6·10장: CAC·파이프라인 전환율 등 정량 근거 없음. 1공장 생산능력 월 25만 세트(연 매출 약 5억 원 상당), 2공장은 2027년 3분기 가동 — 2027년 32억은 생산능력과 대조 검증되지 않음",
  },
  {
    id: "single-supplier",
    title: "(보너스) 원료 단일 공급처 리스크 과소평가",
    deck: "발표덱 3장: '처리비를 받고 수거하는 원료'를 강점으로만 제시",
    proposal: "제안서 8·11장: 수협 1곳 5년 MOU로 전량 조달, 원료 공급 리스크를 '낮음'으로 평가 (대체 공급처 없음)",
  },
] as const;
