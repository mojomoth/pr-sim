// Mock data for the UI PoC (no AI calls). Scenario mirrors docs/screens/draft
// ("친환경 패키징 사업 제안") and fixtures/scripts/facts.mjs (리웨이브 · 웨이브셀).
import type { QAItem, Temperament } from "@/lib/types";
import type { UiJudge } from "./store";

export const DEFAULT_SITUATION = "친환경 패키징 사업 제안\n투자 심사위원을 설득하는 발표";

export const DEFAULT_JUDGES: UiJudge[] = [
  { id: "minseo", name: "민서", temperament: "friendly", gender: "female", age: 45, role: "40대 · 투자심사위원", imageUrl: "/ui/judge-minseo.jpg" },
  { id: "junho", name: "준호", temperament: "strict", gender: "male", age: 54, role: "50대 · 투자심사위원", imageUrl: "/ui/judge-junho.jpg" },
  { id: "doyun", name: "도윤", temperament: "aggressive", gender: "male", age: 42, role: "40대 · 투자심사위원", imageUrl: "/ui/judge-doyun.jpg" },
];

/** Names for judges added with "+ 추가" (no generated face yet → initial avatar). */
export const EXTRA_JUDGE_NAMES = ["서연", "지훈", "하은", "태오", "유진", "현우"];
export const MAX_JUDGES = 5; // 제품 정책 미확정 — PoC 임시 상한

/** Mock STT sentences for the presentation phase (appear one by one). */
export const MOCK_TRANSCRIPT: string[] = [
  "안녕하세요, 리웨이브 대표 발표를 시작하겠습니다.",
  "국내 택배 완충재 폐기물은 연간 약 31만 톤에 달합니다.",
  "저희는 재활용 가능한 소재로 포장 폐기물을 줄이고자 합니다.",
  "웨이브셀은 해조류 부산물로 만든 생분해 완충재입니다.",
  "일반 토양에서 90일 안에 90% 이상 분해됩니다.",
  "완충 성능은 EPS 대비 92% 수준을 확보했습니다.",
  "초기 고객은 친환경 가치를 중시하는 D2C 브랜드입니다.",
  "이번 투자로 완도 공장의 생산 능력을 세 배로 늘리겠습니다.",
];

/** Mock judge questions per temperament, asked in judge order. */
export const MOCK_QUESTIONS: Record<Temperament, string[]> = {
  strict: [
    "기존 포장재 대비 원가가 높다면, 어떤 경쟁력으로 시장을 확보하실 건가요?",
    "발표 자료의 원가와 제안서의 원가가 다릅니다. 어느 쪽이 맞나요?",
  ],
  friendly: [
    "초기 고객사 반응이 궁금해요. 실제로 써 본 브랜드가 있나요?",
    "생분해 인증 절차는 어디까지 진행되었나요?",
  ],
  aggressive: [
    "습한 환경에서 강도가 떨어진다면, 여름철 물류에서는 쓸 수 없는 것 아닌가요?",
    "대기업이 비슷한 소재를 내놓으면 어떻게 버티실 건가요?",
  ],
};

/** Mock STT answers paired with the question order. */
export const MOCK_ANSWERS: string[] = [
  "초기에는 친환경 가치를 중시하는 기업을 중심으로 진입하겠습니다.",
  "현재 D2C 브랜드 세 곳과 파일럿을 진행하고 있습니다.",
  "내수 코팅 2세대를 올해 4분기까지 완료할 계획입니다.",
  "원료 산지에 공장을 두어 원가 구조에서 앞서 있습니다.",
];

export interface MockQA extends QAItem {
  index: number;
}

export const QUESTION_COUNT = 4;

/** Number of Q&A questions for n judges: at least QUESTION_COUNT, and every judge asks at least once. */
export function questionCount(judgeCount: number): number {
  return judgeCount === 0 ? 0 : Math.max(QUESTION_COUNT, judgeCount);
}

/** Build the Q&A rotation from the configured judges: judge i % n asks question i. */
export function buildQuestions(judges: UiJudge[]): MockQA[] {
  if (judges.length === 0) return [];
  const used: Record<Temperament, number> = { strict: 0, friendly: 0, aggressive: 0 };
  return Array.from({ length: questionCount(judges.length) }, (_, i) => {
    const j = judges[i % judges.length];
    const pool = MOCK_QUESTIONS[j.temperament];
    const question = pool[used[j.temperament]++ % pool.length];
    return {
      index: i,
      judge: { id: j.id, name: j.name, temperament: j.temperament },
      question,
      answer: MOCK_ANSWERS[i % MOCK_ANSWERS.length],
    };
  });
}

export const MOCK_RESULT = {
  total: 82,
  verdict: "설득력 있는 발표였어요.",
  scores: [
    { label: "발표력", value: 86 },
    { label: "논리성", value: 80 },
    { label: "대응력", value: 79 },
  ],
  strengths: ["문제와 해결책을 명확하게 전달했어요.", "슬라이드 전환이 발표 흐름과 잘 맞았어요."],
  improvements: ["원가 질문에 수치 근거를 더해 보세요.", "발표 자료와 제안서의 원가 수치를 맞춰 주세요."],
};

export interface FeedbackItem {
  judgeId: string;
  judgeName: string;
  temperament: Temperament;
  headline: string;
  question: string;
  answer: string;
  score: number;
  feedback: string;
  suggestion: string;
}

export const MOCK_FEEDBACK: FeedbackItem[] = [
  {
    judgeId: "junho",
    judgeName: "준호",
    temperament: "strict",
    headline: "답변에 근거를\n더해 보세요.",
    question: "높은 원가를 어떻게\n극복할 계획인가요?",
    answer: "친환경 가치를 중시하는 기업을\n중심으로 진입하겠습니다.",
    score: 79,
    feedback: "고객의 방향은 명확해요.\n원가를 낮출 수치와 실행 계획이 필요해요.",
    suggestion: "초기 고객군을 구체적으로 제시하고,\n생산량 확대에 따른 원가 절감 목표를\n함께 설명해 보세요.",
  },
  {
    judgeId: "minseo",
    judgeName: "민서",
    temperament: "friendly",
    headline: "좋은 사례를\n앞에 두세요.",
    question: "실제로 써 본 브랜드가\n있나요?",
    answer: "현재 D2C 브랜드 세 곳과\n파일럿을 진행하고 있습니다.",
    score: 84,
    feedback: "파일럿 사실을 바로 말한 점이 좋아요.\n재주문 의향 같은 결과를 덧붙이면 더 좋아요.",
    suggestion: "파일럿 브랜드 이름과 기간,\n고객 반응 한 가지를 수치로\n먼저 말해 보세요.",
  },
  {
    judgeId: "doyun",
    judgeName: "도윤",
    temperament: "aggressive",
    headline: "약점은 먼저\n인정하세요.",
    question: "여름철 물류에서는\n쓸 수 없는 것 아닌가요?",
    answer: "내수 코팅 2세대를 올해 4분기까지\n완료할 계획입니다.",
    score: 72,
    feedback: "계획은 있지만 현재 대안이 빠졌어요.\n지금 당장 쓸 수 있는 조건을 말해 주세요.",
    suggestion: "습도 85% 미만 구간의 현재 성능을 먼저 말하고,\n코팅 개발 일정과 검증 방법을\n이어서 설명해 보세요.",
  },
  {
    judgeId: "junho",
    judgeName: "준호",
    temperament: "strict",
    headline: "숫자는 한 가지로\n맞추세요.",
    question: "발표 자료와 제안서의\n원가가 다릅니다.",
    answer: "원료 산지에 공장을 두어\n원가 구조에서 앞서 있습니다.",
    score: 68,
    feedback: "질문의 핵심인 수치 불일치에 답하지 않았어요.\n어느 수치가 최신인지 먼저 밝혀야 해요.",
    suggestion: "세트당 원가의 기준 시점을 밝히고,\n두 자료의 차이가 생긴 이유를\n한 문장으로 정리해 보세요.",
  },
];

export const MOCK_ANALYSIS = {
  headline: "속도는 좋고,\n끝맺음을 다듬어요.",
  metrics: [
    { label: "발표 시간", value: "4:48", unit: "/ 5:00", note: "제한 시간의 96%를 사용했어요." },
    { label: "말 속도", value: "312", unit: "음절/분", note: "권장 범위(280–340) 안이에요." },
    { label: "군말", value: "7", unit: "회", note: "‘어…’, ‘그…’가 도입부에 몰렸어요." },
    { label: "슬라이드 설명", value: "11", unit: "/ 12", note: "9번 슬라이드를 건너뛰었어요." },
  ],
  pace: [62, 78, 84, 80, 74, 88, 70, 66, 58, 40], // relative words per 30s window
  notes: [
    "도입 30초 안에 문제를 숫자로 제시해 주목도를 높였어요.",
    "시장 규모 설명이 길어 해결책 소개가 늦어졌어요.",
    "마지막 슬라이드에서 투자 요청 금액을 다시 말해 주세요.",
  ],
};

export type HistoryStatus = "done" | "in_progress";
export interface HistoryRecord {
  id: string;
  date: string; // YYYY.MM.DD
  title: string;
  presentationMinutes: number;
  qaMinutes: number;
  status: HistoryStatus;
  score?: number;
  phase?: "presentation" | "review";
  remainingSec?: number;
}

export const MOCK_HISTORY: HistoryRecord[] = [
  { id: "h8", date: "2026.11.12", title: "친환경 패키징 사업 제안", presentationMinutes: 5, qaMinutes: 3, status: "done", score: 82 },
  { id: "h7", date: "2026.11.10", title: "신규 서비스 투자 제안", presentationMinutes: 5, qaMinutes: 3, status: "done", score: 76 },
  { id: "h6", date: "2026.11.08", title: "프로젝트 최종 발표", presentationMinutes: 10, qaMinutes: 5, status: "in_progress", phase: "presentation", remainingSec: 372 },
  { id: "h5", date: "2026.11.05", title: "분기 실적 보고", presentationMinutes: 7, qaMinutes: 3, status: "done", score: 79 },
  { id: "h4", date: "2026.11.02", title: "정부 R&D 과제 최종 평가", presentationMinutes: 15, qaMinutes: 10, status: "done", score: 74 },
  { id: "h3", date: "2026.10.29", title: "친환경 패키징 사업 제안", presentationMinutes: 5, qaMinutes: 3, status: "done", score: 71 },
  { id: "h2", date: "2026.10.24", title: "시드 투자 IR 리허설", presentationMinutes: 5, qaMinutes: 5, status: "done", score: 80 },
  { id: "h1", date: "2026.10.20", title: "사내 신사업 공모", presentationMinutes: 3, qaMinutes: 2, status: "done", score: 84 },
];

/** Mock slide deck used when no PDF is available (12 pages, like the draft). */
export const MOCK_SLIDES: { title: string; sub: string; kind: "cover" | "bars" | "points" | "number" }[] = [
  { title: "바다에서 온 완충재", sub: "리웨이브 · 친환경 패키징 사업 제안", kind: "cover" },
  { title: "연 31만 톤의 완충재 폐기물", sub: "문제", kind: "number" },
  { title: "지속 가능한 포장의 시작", sub: "친환경 패키징 사업 제안", kind: "bars" },
  { title: "웨이브셀", sub: "해조 부산물 + 전분 발포 완충재", kind: "points" },
  { title: "90일 내 90% 생분해", sub: "공인시험 성적서", kind: "number" },
  { title: "완충 성능 EPS 대비 92%", sub: "낙하충격 흡수율", kind: "bars" },
  { title: "시장 규모", sub: "TAM · SAM · SOM", kind: "bars" },
  { title: "비즈니스 모델", sub: "D2C 브랜드 직판 + 물류사 제휴", kind: "points" },
  { title: "원가 구조", sub: "세트당 원가와 판매가", kind: "bars" },
  { title: "경쟁 비교", sub: "EPS · 에어캡 · 종이 · 균사체", kind: "points" },
  { title: "팀", sub: "연구 5 · 생산 5 · 영업 2 · 경영 2", kind: "points" },
  { title: "투자 요청", sub: "완도 공장 증설 · 생산능력 3배", kind: "number" },
];
