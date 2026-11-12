import "server-only";
import { z } from "zod";
import { TEMPERAMENT_LABEL, type Temperament } from "../types";

// Prompts + zod schemas for the report judgments. Schemas avoid min/max/int constraints (Claude structured outputs
// and OpenAI strict mode both accept plain number/string/enum/array/object/nullable); scores are clamped in code.

const Score = z.number().describe("0–100 정수 점수");
const Severity = z.enum(["high", "medium", "low"]);

const RefSchema = z.object({
  doc: z.enum(["presentation", "proposal"]).describe("presentation=발표자료(덱), proposal=제안자료"),
  pages: z.array(z.number()).describe("근거가 있는 원문 쪽 번호 (p.N)"),
  quote: z.string().nullable().describe("그 문서에 적힌 핵심 값/표현 그대로 (예: '142원', '약 14%'). 쪽 번호 재검증에 쓰임"),
});

const ContradictionSchema = z.object({
  claim: z.string().describe("발표자가 말한 내용 (인용 또는 요약)"),
  docSays: z.string().describe("자료에 적힌 내용과 출처 (예: '제안자료 p.34: 세트당 원가 142원')"),
  refs: z.array(RefSchema),
  severity: Severity,
});

const COMMON_RULES = `
공통 규칙
- 출력은 한국어. 존댓말 대신 간결한 평어/해요체 혼용 금지 — 피드백 문장은 해요체("~해요", "~해 보세요")로 통일.
- 자료(발표자료·제안자료)에 있는 사실만 근거로 쓰고, 출처는 반드시 원문 쪽 번호 (p.N)로 남긴다. 자료에 없는 사실을 지어내지 않는다.
- 발표자료와 제안자료가 서로 다른 수치를 적고 있으면 그것 자체가 중요한 발견이다. 한쪽만 보고 단정하지 말고 두 쪽 번호를 모두 남긴다.
- STT 전사이므로 동음이의 오기(완충재→완충제, 대체재→대체제 등)나 띄어쓰기는 감점하지 않는다.
- 점수는 0–100 정수. 아래 루브릭의 구간 정의에 맞춰 보정한다(관대하게 주지 말 것). 70점은 "보통", 85점 이상은 "실제 심사에서도 좋은 평가".
`;

const BANDS = `
점수 구간 (모든 항목 공통 보정 기준)
- 90–100 탁월: 심사위원이 추가 질문 없이 납득. 구체적 수치·출처·논리 연결이 모두 있음.
- 75–89 양호: 핵심은 정확하고 충분하나 한두 군데 근거·구체성이 아쉬움.
- 60–74 보통: 방향은 맞지만 근거가 약하거나 일부만 다룸.
- 40–59 미흡: 질문/과제의 핵심을 비껴가거나, 근거 없이 주장하거나, 중요한 누락이 있음.
- 0–39 부적절: 자료와 모순되는 사실, 회피, 무응답, 틀린 수치가 핵심을 차지.
`;

// ───────────────────────── speech (content) ─────────────────────────

export const SpeechSchema = z.object({
  scores: z.object({ structure: Score, clarity: Score, persuasiveness: Score }),
  summary: z.string().describe("발표 내용 총평 2문장"),
  structureNote: z.string(),
  clarityNote: z.string(),
  persuasivenessNote: z.string(),
  strengths: z.array(z.string()).describe("2–3개, 전사 근거 포함"),
  improvements: z.array(z.string()).describe("2–4개, 구체적 행동으로"),
  coverage: z
    .array(
      z.object({
        page: z.number(),
        title: z.string().describe("슬라이드 제목(짧게)"),
        status: z.enum(["covered", "partial", "missing"]),
        sentences: z.array(z.number()).describe("이 슬라이드를 다룬 전사 문장 번호 [i]"),
        note: z.string().describe("partial/missing이면 빠진 핵심 내용, covered면 한 줄"),
      }),
    )
    .describe("발표자료의 모든 쪽(슬라이드)마다 1개"),
  numberIssues: z.array(ContradictionSchema).describe("발표 중 말한 수치·사실이 자료와 다른 경우만. 없으면 빈 배열"),
});

export function speechPrompt(a: { situation: string; minutes: number; transcript: string; deck: string; deckNumbers: string; proposalNumbers: string }) {
  const system = `당신은 투자·공모 심사 발표를 코칭하는 수석 평가자다. STT로 전사된 발표 내용을 발표자료(덱)와 대조해 "내용" 측면만 평가한다.
말 속도·군말·시간 같은 전달 지표는 코드가 따로 계산하므로 평가하지 않는다.
${COMMON_RULES}
${BANDS}
루브릭
- structure(구조): 문제→해결→시장→모델→트랙션→재무→팀→요청의 흐름, 전환 문장, 결론/요청의 명확성. 핵심 슬라이드를 건너뛰면 감점.
- clarity(명료성): 한 문장에 한 메시지, 전문용어 설명, 수치 제시 방식(기준 연도·단위)이 듣는 사람에게 분명한가.
- persuasiveness(설득력): 고객 문제의 절실함, 차별점, 트랙션·근거 수치의 사용, 투자 요청과 근거의 연결. 근거 없이 단정하는 성장 가정은 감점.
- 발표 중 말한 수치가 발표자료/제안자료와 다르면 numberIssues에 넣는다. 자료 어디에도 없는 틀린 수치는 high. 자료끼리 다른 수치 중 한쪽을 그대로 말한 것도 기록은 하되(refs에 두 문서 모두) severity는 low — 발표자 잘못이 아니라 자료 간 불일치이므로 점수를 깎지 않는다(코드가 쪽 원문으로 다시 확인). 자료 어디에도 없는 틀린 수치가 있을 때만 persuasiveness를 70 이하로 제한.
- coverage: 덱의 모든 쪽에 대해 covered(핵심 메시지와 주요 수치를 말함)/partial(일부만)/missing(언급 없음). 표지(1쪽)는 인사·회사 소개를 했으면 covered.`;
  const user = `## 상황
${a.situation}
발표 제한 시간: ${a.minutes}분

## 발표 전사 (문장 번호 [i], 시작 시각 초)
${a.transcript}

## 발표자료 원문 (쪽별)
${a.deck}

## 발표자료 주요 수치
${a.deckNumbers}

## 제안자료 주요 수치 (참고: 덱과 다를 수 있음)
${a.proposalNumbers}

위 루브릭으로 평가해 JSON으로 답하라.`;
  return { system, user };
}

// ───────────────────────── Q&A ─────────────────────────

export const QASchema = z.object({
  scores: z.object({ relevance: Score, accuracy: Score, evidence: Score, completeness: Score, composure: Score }),
  verdict: z.enum(["strong", "adequate", "weak", "evasive"]),
  feedback: z.string().describe("심사위원 피드백: 해요체 2문장 이내. 첫 문장은 잘한 점 또는 핵심 문제, 둘째 문장은 무엇이 필요했는지"),
  rationale: z.string().describe("점수 근거 2–4문장. 루브릭 항목을 언급"),
  contradictions: z.array(ContradictionSchema).describe("답변 속 사실·수치가 자료와 다르거나, 자료 간 불일치를 해소하지 못한 경우. 없으면 빈 배열"),
  evidenceUsed: z.array(z.string()).describe("답변이 실제로 사용한 근거(수치·사실)"),
  missing: z.array(z.string()).describe("좋은 답변이라면 포함했어야 할 핵심 요소 1–4개"),
  improvedAnswer: z.string().describe("이렇게 답해 보세요: 발표자 1인칭, 말로 30초 안(200–320자). 자료의 실제 수치와 쪽 근거에 기반하고, 자료 간 불일치가 있으면 솔직히 인정·정정하는 문장 포함"),
  citations: z.array(RefSchema).describe("improvedAnswer가 사용한 사실의 출처"),
});

const TEMPERAMENT_DESC: Record<Temperament, string> = {
  friendly: "친절함 — 격려하며 묻지만 근거는 확인한다",
  strict: "빡셈 — 수치와 논리의 정합성을 끝까지 따진다",
  aggressive: "공격적 — 약점을 정면으로 찌르고 회피를 용납하지 않는다",
};

export function qaPrompt(a: {
  situation: string;
  judgeName: string;
  temperament: Temperament;
  question: string;
  answer: string;
  answerFillers: number;
  deckCtx: string;
  proposalCtx: string;
  crossLint: string;
  talkExcerpt: string;
}) {
  const system = `당신은 투자·공모 심사의 질의응답을 채점하는 수석 평가자다. 질문 하나와 발표자의 답변(STT 전사)을 자료와 대조해 타당성을 평가한다.
${COMMON_RULES}
${BANDS}
루브릭 (각 0–100)
- relevance(관련성): 질문이 실제로 물은 것(숫자 확인, 근거, 계획 등)에 직접 답했는가. 다른 이야기로 돌리거나 "방향성은 확실하다" 식으로 넘기면 50 이하.
- accuracy(사실 정확성): 답변 속 사실·수치가 자료와 '모순'되는가로 판단한다. 자료와 모순되는 수치를 단정하면 40 이하. 자료끼리 다른 수치를 지적받았는데 근거 없이 한쪽을 맞다고 하거나 "아마"로 추측하면 50 이하. 자료에 없지만 모순되지도 않는 일화·고객 피드백·추가 수치는 모순이 아니다 — accuracy는 75 이상을 유지하고, evidence에서만 소폭(최대 10점) 감점하며 rationale에 '자료로 확인 불가'라고 적는다(contradictions에는 넣지 않는다).
- evidence(근거 활용): 자료의 구체적 수치·사실·계산을 근거로 썼는가. 주장만 있고 근거가 없으면 50 이하.
- completeness(완결성): 질문의 모든 하위 질문(예: '가능한가' + '왜')을 다뤘는가, 남은 리스크·대안까지 언급했는가.
- composure(태도·침착성): 방어적이거나 얼버무림("아, 음", "아마", "어쨌든") 없이 차분하고 단정하게 답했는가. 군말 수(코드 계산)를 참고. 심사위원 성향이 공격적이어도 감정적이지 않고 사실로 대응하면 높은 점수.
- verdict: strong(평균 ≥80, 모순 없음) / adequate(65–79) / weak(<65, 근거 부족·부분 답변) / evasive(질문의 핵심을 피함 — 점수와 무관하게 회피면 evasive).
- contradictions: refs에는 근거 문서와 쪽, quote에는 그 문서에 적힌 값 그대로. 발표자료와 제안자료 값이 다르면 refs를 2개(각 문서) 넣는다.
- improvedAnswer는 자료에 있는 사실만으로 만든다. 자료에 근거가 없는 내용을 지어내지 말고, 근거가 없으면 "현재 자료에는 X가 없어 추가로 제시하겠다"처럼 정직하게 말하게 한다.`;
  const user = `## 상황
${a.situation}

## 심사위원
${a.judgeName} (${TEMPERAMENT_LABEL[a.temperament]}: ${TEMPERAMENT_DESC[a.temperament]})

## 질문
${a.question}

## 발표자 답변 (STT)
${a.answer || "(무응답)"}
(코드가 센 답변 속 군말: ${a.answerFillers}회)

## 발표자료 근거
${a.deckCtx}

## 제안자료 근거 (위키 질의 결과, (p.N)은 원문 쪽)
${a.proposalCtx}

## 문서 간 수치 불일치 점검 결과 (위키 lint)
${a.crossLint}

## 발표 중 관련 발언 (전사 발췌)
${a.talkExcerpt || "(없음)"}

루브릭으로 채점해 JSON으로 답하라.`;
  return { system, user };
}

// ───────────────────────── documents ─────────────────────────

export const DocSchema = z.object({
  scores: z.object({ structure: Score, logic: Score, evidence: Score, consistency: Score, clarity: Score }),
  summary: z.string().describe("문서 품질 총평 2문장"),
  strengths: z.array(z.string()).describe("2–3개"),
  issues: z
    .array(
      z.object({
        severity: Severity,
        category: z.enum(["structure", "logic", "evidence", "consistency", "clarity"]),
        title: z.string().describe("짧은 제목"),
        detail: z.string().describe("무엇이 문제인지, 쪽 번호와 수치를 포함해 1–3문장"),
        refs: z.array(RefSchema),
        fix: z.string().describe("구체적 수정 방법 (어느 쪽에 무엇을 추가/정정)"),
      }),
    )
    .describe("중요도 순 3–7개"),
});

export function docPrompt(a: { role: "presentation" | "proposal"; situation: string; filename: string; pages: number; body: string; numbers: string; selfLint: string; crossLint: string; otherNumbers: string }) {
  const label = a.role === "presentation" ? "발표자료(피치덱)" : "제안자료(사업계획서)";
  const system = `당신은 투자·공모 심사에서 제출 자료를 검토하는 수석 심사역이다. ${label}의 품질을 평가한다. 시각 디자인은 텍스트만으로 알 수 없으므로 평가하지 않는다.
${COMMON_RULES}
${BANDS}
루브릭 (각 0–100)
- structure(구성): ${a.role === "presentation" ? "문제→해결→시장→모델→경쟁→트랙션→재무→팀→요청의 흐름, 한 장 한 메시지" : "요약→문제→시장→제품→사업모델→운영→재무→리스크→투자조건의 완결성, 장별 연결"}.
- logic(논리): 주장과 결론이 앞의 사실에서 따라 나오는가. 성장 가정, 생산능력×판매가 같은 산술 정합성, 인과 비약.
- evidence(근거 강도): 정량 근거·출처·가정의 명시(전환율, CAC, 파이프라인, 시장 산정 방식). 확정적 어조만 있고 근거가 없으면 감점.
- consistency(수치 일관성): 문서 내부 및 상대 문서(${a.role === "presentation" ? "제안자료" : "발표자료"})와 같은 지표 값이 일치하는가. 상대 문서와 핵심 수치(원가·이익률·시장 규모 등)가 다르면 60 이하.
- clarity(명료성): 기준 연도·단위·용어 정의가 분명한가, 읽는 사람이 핵심을 바로 찾는가.
- issues: 실제 쪽 번호와 값(quote)을 근거로. 위키 lint 결과를 참고하되 사소한 표기 차이(158만 vs 157.6만 같은 반올림)는 low.`;
  const user = `## 상황
${a.situation}

## 평가 대상: ${label} — ${a.filename} (${a.pages}쪽)
${a.body}

## 이 문서의 주요 수치 (위키)
${a.numbers}

## 상대 문서의 주요 수치 (비교용)
${a.otherNumbers || "(상대 문서 없음)"}

## 위키 점검(lint) — 이 문서 단독
${a.selfLint}

## 위키 점검(lint) — 상대 문서와 수치 불일치
${a.crossLint}

루브릭으로 평가해 JSON으로 답하라.`;
  return { system, user };
}

export const ConsistencySchema = z.object({
  rows: z
    .array(
      z.object({
        metric: z.string(),
        presentation: z.object({ value: z.string(), pages: z.array(z.number()) }).nullable(),
        proposal: z.object({ value: z.string(), pages: z.array(z.number()) }).nullable(),
        status: z.enum(["match", "mismatch", "only-one"]),
        note: z.string().describe("불일치면 영향(무엇이 흔들리는지) 한 문장, 일치면 빈 문자열"),
      }),
    )
    .describe("심사에 중요한 핵심 지표 10–16개. 불일치 항목을 빠짐없이 먼저"),
});

export function consistencyPrompt(a: { deckNumbers: string; proposalNumbers: string; crossLint: string }) {
  const system = `당신은 발표자료와 제안자료의 수치 일관성을 대조하는 재무 실사 담당자다. 두 문서의 주요 수치 표를 같은 지표끼리 짝지어 비교한다.
- 같은 지표·같은 기준(연도, 단위)일 때만 비교한다. 기준이 다르면(예: 2026 vs 2028 목표) 다른 지표로 본다.
- 값이 같은 의미면 match(표기만 다른 158만 vs 158만 세트는 match), 다르면 mismatch, 한 문서에만 있으면 only-one.
- 원가, 매출총이익률, 시장 규모(TAM/SAM/SOM), 매출 계획, 판매가, 고객 수, 재구매율, 투자 금액·기업가치, 생산능력은 꼭 포함.
- pages는 표에 적힌 쪽 번호를 그대로 쓴다.`;
  const user = `## 발표자료 주요 수치
${a.deckNumbers}

## 제안자료 주요 수치
${a.proposalNumbers}

## 위키 lint의 문서 간 불일치 (참고)
${a.crossLint}

JSON으로 답하라.`;
  return { system, user };
}

// ───────────────────────── overall ─────────────────────────

export const OverallSchema = z.object({
  headline: z.string().describe("결과 화면의 큰 제목 한 문장, 18자 이내, 마침표로 끝남 (예: '답변에 근거를 더해 보세요.')"),
  oneLiner: z.string().describe("점수 카드 아래 한 줄 평, 25자 이내 해요체 (예: '설득력 있는 발표였어요.')"),
  strengths: z.array(z.string()).describe("잘한 점 2–3개, 각 40자 이내 해요체, 구체적 근거 포함"),
  priorities: z
    .array(z.object({ title: z.string().describe("25자 이내"), why: z.string().describe("근거(지표·질문·쪽) 한 문장"), how: z.string().describe("다음 연습에서 할 구체 행동 한 문장") }))
    .describe("우선 개선점 정확히 3개, 점수 영향이 큰 순서"),
});

export function overallPrompt(digest: string) {
  const system = `당신은 발표 코치다. 이미 계산·평가된 섹션 결과를 종합해 결과 화면 문구를 쓴다. 점수는 코드가 계산했으니 바꾸거나 새로 매기지 않는다.
- 잘한 점은 실제 결과에 근거한 것만. 칭찬할 것이 적으면 작은 것이라도 사실대로.
- 우선 개선점 3개는 점수에 가장 큰 영향을 준 문제부터: 자료와 모순되는 답변/수치, 회피성 답변, 자료 간 수치 불일치, 근거 없는 성장 가정, 전달 지표(말 속도·군말·시간) 순으로 영향이 큰 것을 고른다.
- 해요체, 짧고 구체적으로. 쪽 번호·수치를 넣을 수 있으면 넣는다.`;
  return { system, user: `${digest}\n\nJSON으로 답하라.` };
}
