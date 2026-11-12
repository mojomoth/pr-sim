import "server-only";
import { z } from "zod";
import type { DocKind } from "./types";

const DOC_LABEL: Record<DocKind, string> = { presentation: "발표자료(피치덱)", proposal: "제안자료(사업계획서)" };

const CANONICAL_TOPICS = [
  "회사-소개",
  "문제-정의",
  "솔루션",
  "제품-기술",
  "시장-규모",
  "고객-세일즈",
  "경쟁사",
  "비즈니스-모델",
  "원가-구조",
  "운영-생산",
  "재무-계획",
  "투자-조건",
  "팀",
  "리스크",
  "로드맵",
  "파트너십",
  "규제-인증",
  "성과-지표",
];

const GROUNDING = `원문에 있는 내용만 쓴다. 추측·일반 상식 보충 금지. 수치는 원문 표기 그대로(단위 포함). 한국어로 쓴다.`;

// ---------- 1) EXTRACT (per chunk, parallel) ----------

export const ExtractSchema = z.object({
  summary: z.string().describe("이 청크의 2~4문장 요약. 문장마다 (p.N) 출처"),
  topics: z
    .array(
      z.object({
        slug: z.string().describe("한국어 kebab-case slug. 가능하면 표준 목록에서 고른다"),
        title: z.string(),
        type: z.enum(["entity", "concept", "topic"]),
        facts: z.array(
          z.object({
            claim: z.string().describe("독립적으로 읽히는 한 문장의 사실(수치·고유명사 보존)"),
            pages: z.array(z.number()).describe("근거 쪽 번호(이 청크 범위 안)"),
          }),
        ),
      }),
    )
    .describe("이 청크가 다루는 주제들"),
  numbers: z
    .array(
      z.object({
        metric: z.string().describe("수치 항목 이름, 예: '세트당 원가', 'SOM', '2027년 매출 목표'"),
        value: z.string().describe("원문 표기 그대로, 예: '142원', '210억 원', '약 14%'"),
        pages: z.array(z.number()),
        context: z.string().describe("짧은 맥락(기준 연도·조건 등)"),
      }),
    )
    .describe("핵심 정량 정보(금액·비율·수량·기간·목표)"),
});
export type ExtractNotes = z.infer<typeof ExtractSchema>;

export function extractPrompt(kind: DocKind, filename: string, pages: { n: number; text: string }[], pageCount: number) {
  const system = `너는 사용자가 업로드한 ${DOC_LABEL[kind]}로 'LLM 위키'를 만드는 편집자다. 지금은 INGEST 1단계: 문서의 일부 쪽(청크)을 읽고 위키에 넣을 사실을 주제별로 뽑는다.
규칙:
- ${GROUNDING}
- 사실(claim)은 다른 맥락 없이도 이해되는 한 문장. 주어를 명시한다(예: "웨이브셀 세트당 원가는 142원이다").
- pages에는 이 청크(p.${pages[0].n}–${pages[pages.length - 1].n}) 안의 실제 근거 쪽만 넣는다.
- 주제 slug는 가능하면 표준 목록에서 고른다: ${CANONICAL_TOPICS.join(", ")}. 문서의 핵심 고유 대상(제품명, 회사명, 주요 파트너·경쟁사 등)은 별도 entity slug(예: "웨이브셀")로 만든다. 목차·머리말·쪽 번호 같은 형식 요소는 무시한다.
- 'overview', 'index', 'log', '주요-수치'는 예약어이므로 slug로 쓰지 않는다.
- 숫자가 등장하면 numbers에도 반드시 넣는다(같은 항목이 여러 쪽에 나오면 pages에 모두).
- 주제당 사실은 핵심 위주로 최대 12개. 반복 서술은 하나로 합친다.`;
  const user = `문서: ${filename} (전체 ${pageCount}쪽)\n\n${pages.map((p) => `=== p.${p.n} ===\n${p.text.trim() || "(텍스트 없음)"}`).join("\n\n")}`;
  return { system, user };
}

// ---------- 2) PLAN (consolidate slugs → final page list) ----------

export const PlanSchema = z.object({
  pages: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      type: z.enum(["entity", "concept", "topic"]),
      from: z.array(z.string()).describe("이 페이지로 합쳐질 후보 slug들(자기 자신 포함)"),
    }),
  ),
});
export type Plan = z.infer<typeof PlanSchema>;

export function planPrompt(kind: DocKind, candidates: { slug: string; title: string; type: string; facts: number; sample: string }[], maxPages: number) {
  const system = `너는 ${DOC_LABEL[kind]} 위키의 편집장이다. 청크별로 뽑힌 주제 후보 slug들을 보고 최종 위키 페이지 구조를 정한다.
규칙:
- 같은 대상을 가리키는 후보(동의어·표기 차이·하위 주제)는 하나의 페이지로 합친다. 너무 작은 후보(사실 1~2개)는 가장 가까운 페이지에 합친다.
- 최종 페이지는 ${Math.max(8, Math.min(maxPages, 30))}개 이하. 표준 slug(${CANONICAL_TOPICS.join(", ")})가 맞으면 그것을 쓴다.
- 모든 후보 slug는 정확히 한 페이지의 from에 들어가야 한다.
- 'overview', 'index', 'log', '주요-수치'는 만들지 않는다(시스템이 따로 만든다).`;
  const user = candidates.map((c) => `- ${c.slug} | ${c.title} | ${c.type} | 사실 ${c.facts}개 | 예: ${c.sample}`).join("\n");
  return { system, user };
}

// ---------- 3) WRITE (merge round, one call per touched page, parallel across pages) ----------

export const WriteSchema = z.object({
  action: z.enum(["create", "update", "append", "skip"]),
  title: z.string(),
  summary: z.string().describe("index.md에 들어갈 한 줄 요약(40자 내외). 이번에 바꾼 점이 아니라 페이지 전체가 담는 내용을 쓴다('보강', '반영' 같은 말 금지)"),
  markdown: z
    .string()
    .describe("create/update: frontmatter 없이 '# 제목'부터 시작하는 페이지 전체 본문. append: 기존 페이지 끝에 붙일 '## 소제목' 섹션(들). skip: 빈 문자열"),
});
export type WriteOp = z.infer<typeof WriteSchema>;

export function writePrompt(args: {
  kind: DocKind;
  filename: string;
  slug: string;
  title: string;
  existing: string | null;
  facts: { claim: string; pages: number[] }[];
  indexMd: string;
  allPages: { slug: string; title: string }[];
  round: number;
  rounds: number;
  pageRange: string;
}) {
  const system = `너는 ${DOC_LABEL[args.kind]} \`${args.filename}\` 위키의 편집자다. INGEST 병합 라운드 ${args.round}/${args.rounds}(새로 읽은 범위 ${args.pageRange})에서 페이지 [[${args.slug}]] 하나를 담당한다.
위키 규칙:
- ${GROUNDING}
- 모든 사실 문장 끝에 출처 쪽 (p.N) / (p.N, p.M) / (p.N–M)을 단다. 새 사실에 주어진 쪽 번호를 그대로 쓴다.
- 형식: '# 제목' → '> 한 줄 요약' → '## 소제목' 아래 글머리표. 표가 더 명확하면 마크다운 표를 쓴다.
- 다른 페이지를 언급할 때 아래 목록에 있는 slug만 [[slug]] 또는 [[slug|표시]]로 링크한다(본문에서 2~6개 정도 자연스럽게).
- 기존 내용과 새 사실이 다른 값을 말하면 둘 다 남기고 **[불일치]** 표시와 각 출처를 붙인다.
- 판단·평가는 **[검토]**로 시작한다(예: 근거가 부족한 가정).
- 비슷하지만 다른 개념(판매가 vs 원가, 매출 vs 이익, TAM/SAM/SOM, 목표 vs 실적)을 한 표·한 문장에 섞지 않는다. 같은 대상의 다른 이름(회사명 국문/영문, 제품명)은 하나로 통일한다.
동작 선택:
- 페이지가 없으면 create(전체 본문).
- 새 사실이 기존 구조에 섞여야 하거나 수정·충돌 표시가 필요하면 update(기존 내용을 잃지 말고 전체 본문 재작성).
- 새 사실이 기존과 독립된 새 소제목으로 충분하면 append(붙일 섹션만).
- 새 사실이 이미 모두 반영돼 있으면 skip.`;
  const user = `## 현재 index.md
${args.indexMd || "(아직 없음)"}

## 링크 가능한 페이지
${args.allPages.map((p) => `- [[${p.slug}]] ${p.title}`).join("\n")}

## 담당 페이지: [[${args.slug}]] (${args.title})
${args.existing ? `### 기존 본문\n${args.existing}` : "(아직 없음 → create)"}

## 이번 라운드의 새 사실
${args.facts.map((f) => `- ${f.claim} (p.${f.pages.join(", p.")})`).join("\n")}`;
  return { system, user };
}

// ---------- 4) FINALIZE: overview + key numbers ----------

export const OverviewSchema = z.object({
  summary: z.string().describe("index에 들어갈 문서 내용 한 줄 요약(40자 내외). 예: '해조류 완충재 웨이브셀로 Pre-A 20억 유치 제안'"),
  markdown: z.string().describe("frontmatter 없이 '# 개요'부터 시작하는 overview 본문"),
});

export function overviewPrompt(kind: DocKind, filename: string, pageCount: number, indexMd: string, chunkSummaries: string[]) {
  const system = `너는 ${DOC_LABEL[kind]} 위키의 편집장이다. 마지막으로 overview 페이지를 쓴다. 심사위원이 이 문서를 처음 볼 때 읽는 페이지다.
- ${GROUNDING}
- 구성: '# 개요' → '> 한 줄 요약' → '## 한눈에 보기'(5~8개 글머리표, 각 (p.N) 출처) → '## 문서 구성'(쪽 범위별 흐름) → '## 핵심 주장' → '## 검토 포인트'(**[검토]**로 시작: 근거가 약하거나 수치가 맞지 않거나 검증이 필요한 지점; 원문 근거와 쪽 번호 포함) → '## 읽는 순서'([[slug]] 링크 목록, [[주요-수치]] 포함).
- 링크는 index에 있는 slug만 쓴다.`;
  const user = `문서: ${filename} (${pageCount}쪽)\n\n## index.md\n${indexMd}\n\n## 청크 요약(쪽 순서)\n${chunkSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
  return { system, user };
}

export const NumbersSchema = z.object({
  numbers: z.array(
    z.object({
      metric: z.string().describe("정규화한 항목명. 같은 대상은 같은 이름으로"),
      value: z.string().describe("원문 표기 그대로"),
      pages: z.array(z.number()),
      note: z.string().describe("기준·조건·연도 등. 충돌이면 무엇과 다른지"),
      conflict: z.boolean().describe("같은 항목·같은 기준인데 문서 안에서 다른 값이 나오면 true"),
    }),
  ),
});

export function numbersPrompt(kind: DocKind, filename: string, raw: { metric: string; value: string; pages: number[]; context: string }[]) {
  const system = `너는 ${DOC_LABEL[kind]}의 '주요-수치' 페이지를 만든다. 청크별로 뽑힌 수치 후보를 정리한다.
- 같은 항목(같은 대상·같은 기준·같은 연도)은 하나로 합치고 pages를 모은다. 항목명은 일관되게 정규화한다(예: '세트당 원가', '매출총이익률', 'SOM', '2027년 매출 목표').
- 같은 항목인데 값이 다르면 각각 별도 행으로 남기고 conflict=true, note에 무엇과 다른지 쓴다. 단, 연도·시나리오·기준이 달라서 다른 값이면 충돌이 아니다(항목명에 기준을 넣는다).
- 심사에 중요한 수치(시장 규모, 가격·원가·마진, 매출·이익 계획, 고객·재구매, 생산능력, 투자 금액·지분·밸류, 인력)를 우선하고 사소한 수치는 버린다. 최대 60행.
- 값은 원문 표기 그대로. 새 수치를 계산해서 만들지 않는다.`;
  const user = `문서: ${filename}\n${raw.map((r) => `- ${r.metric} = ${r.value} (p.${r.pages.join(",")}) — ${r.context}`).join("\n")}`;
  return { system, user };
}

// ---------- QUERY ----------

export const SelectSchema = z.object({
  slugs: z.array(z.string()).describe("질문에 답하는 데 필요한 페이지 slug, 중요도 순"),
});

export function selectPrompt(indexMd: string, query: string, maxPages: number) {
  const system = `너는 위키 검색기다. index.md 카탈로그를 보고 질문에 답하는 데 필요한 페이지를 최대 ${maxPages}개, 중요도 순으로 고른다. 수치·일관성 질문이면 '주요-수치'를 포함한다. 전체 요약 질문이면 'overview'를 포함한다. index에 있는 slug만 쓴다.`;
  const user = `## index.md\n${indexMd}\n\n## 질문\n${query}`;
  return { system, user };
}

export const AnswerSchema = z.object({ answer: z.string() });

export function answerPrompt(context: string, query: string) {
  const system = `너는 업로드된 문서의 위키를 근거로 답하는 조수다.
- 아래 컨텍스트(위키 발췌)에 있는 내용만으로 한국어로 간결하게 답한다(3~6문장 또는 글머리표).
- 문장마다 컨텍스트에 있는 출처 쪽을 괄호 형식 (p.N) 또는 (p.N, p.M)으로 문장 끝에 붙인다. 본문에 "p.64에" 같은 맨 쪽 번호를 쓰지 말고 항상 괄호 형식으로 쓴다. 컨텍스트에 없는 쪽 번호를 만들지 않는다. 인용은 그 문장의 수치가 실제로 나오는 쪽 위주로 3개 이하.
- 컨텍스트에 **[불일치]**가 있으면 두 값과 출처를 모두 밝힌다.
- 컨텍스트에 답이 없으면 "위키에서 찾지 못했습니다"라고 말하고 추측하지 않는다.
- "가능한가/타당한가/충분한가/현실적인가" 같은 판단 질문에는 결론부터 내지 않는다. 먼저 컨텍스트의 수치로 계산식을 한 줄로 직접 보여 준다(예: 월 생산량 × 12개월 × 판매가 = 연 매출 상한). 한국어 단위는 원 단위로 바꿔 계산한다(1만=10,000, 1억=100,000,000; 예: 30만×12×200원=720,000,000원=7.2억 원). 그 계산이 목표치에 못 미치면 "자료의 수치만으로는 뒷받침되지 않는다"고 쓴다. 계산에 필요한 수치가 컨텍스트에 없으면 어떤 수치가 빠졌는지 밝히고 판단을 보류한다.
- 문서의 주장(예: "충분하다", "가능하다")을 그대로 결론으로 옮기지 않는다. 그것은 "문서는 ~라고 주장한다"로 쓴다.`;
  const user = `## 컨텍스트\n${context}\n\n## 질문\n${query}`;
  return { system, user };
}

// ---------- LINT ----------

export const LintSchema = z.object({
  issues: z.array(
    z.object({
      type: z.enum(["contradiction", "cross-doc-mismatch", "gap", "missing-page", "stale"]),
      severity: z.enum(["high", "medium", "low"]),
      message: z.string().describe("한국어 한두 문장. 무엇이 어떻게 다른지 값과 함께"),
      pages: z.array(z.string()).describe("관련 위키 slug"),
      citations: z.array(z.number()).describe("이 문서의 근거 쪽"),
      otherCitations: z.array(z.number()).describe("비교 문서의 근거 쪽(비교가 아니면 빈 배열)"),
    }),
  ),
});

export function lintPrompt(args: {
  kind: DocKind;
  filename: string;
  indexMd: string;
  pagesText: string;
  numbers: string;
  conflicts: string;
  other?: { kind: DocKind; filename: string; numbers: string; indexMd: string };
}) {
  const system = `너는 위키 LINT 검사기다. 위키의 건강 상태를 점검해 문제 목록을 낸다.
점검 항목:
- contradiction: 같은 문서 안에서 같은 항목의 값/주장이 서로 다름.
- gap: 심사에 필요한데 문서에 근거가 없거나 검증되지 않은 핵심 가정. 특히 확인할 것: 매출 성장 목표의 정량 근거(전환율·CAC·파이프라인), 생산능력(월 생산량×판매가)으로 매출 목표가 물리적으로 가능한지 직접 계산해 보기, 핵심 원료·공급처가 단일한지와 그 리스크 평가가 타당한지, 시장 점유율 가정의 근거.
- missing-page: 여러 곳에서 언급되지만 독립 페이지가 없는 중요한 대상.
- stale: 시점이 지난 수치·계획으로 보이는 주장.
${args.other ? "- cross-doc-mismatch: 두 문서(아래 '비교 문서')가 같은 항목에 다른 값을 쓰는 경우. 값과 양쪽 쪽 번호를 모두 쓴다. 기준·연도가 달라 생기는 차이는 제외." : ""}
- 원문 근거가 있는 지적만 한다. message에는 관련 수치를 원문 표기 그대로(예: '142원', '월 25만 세트') 넣는다. 각 이슈에 근거 쪽 번호를 단다. 최대 15개, 중요도 순.`;
  let user = `## 문서: ${args.filename} (${DOC_LABEL[args.kind]})\n### index\n${args.indexMd}\n### 페이지 본문(발췌)\n${args.pagesText}\n### 주요 수치\n${args.numbers}\n### 문서 내 충돌 후보(자동)\n${args.conflicts || "(없음)"}`;
  if (args.other) user += `\n\n## 비교 문서: ${args.other.filename} (${DOC_LABEL[args.other.kind]})\n### index\n${args.other.indexMd}\n### 주요 수치\n${args.other.numbers}`;
  return { system, user };
}
