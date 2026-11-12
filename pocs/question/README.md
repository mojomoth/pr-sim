# question — 심사 질문 PoC

> 요구사항: "STT로 전사된 발표 목소리와 발표자료 그리고 제안자료등을 이용해서 심사위원 페르소나로 질문 · 심사위원 페르소나 (친절함, 빡셈, 공격적)에 따라"

**확인 URL:** http://localhost:3100/question (모바일 390px 우선, 데스크톱 2열)

| 기능 | 결과 |
|---|---|
| 전사 + 발표자료·제안자료 위키로 컨텍스트 구성 | ✅ 위키 질의 16건(LLM 0회, 9~185ms), 원본 105k자 중 26.8k자(25%)만 사용. 128쪽 문서도 26.3k자 |
| 성향별 질문(친절함·빡셈·공격적) 스트리밍 생성 | ✅ 3명 × 2문항. 첫 글자 1.9~3.0초, 첫 질문 5.4~6.6초, 전체 6.1~10.9초 |
| 근거(evidence) 원문 검증 | ✅ 6회 실행의 인용 **72/72개가 raw 원문·전사와 정확히 일치**(독립 재검사) |
| 의도된 약점 탐지 | ✅ 4종 모두 탐지: 원가 118↔142원 8회, SOM 340↔210억 5회, 성장·생산능력 3회, 단일 공급처 3회 |
| 성향 구분 | ✅ 별도 LLM이 라벨 없이 질문만 보고 성향을 맞힌 비율 **93%**(28/30) |
| 심사위원 간 중복 없음 | ✅ 실행마다 심사위원 간 질문 유사도 최대 0.11~0.29, 같은 검토 포인트를 두 명이 묻는 경우 0 |
| 답변 → 꼬리질문 / 다음 질문 | ✅ 회피성 답변 → 꼬리질문, 강한 답변 → 다음 질문(충분 5/5). 시간이 부족하면 다음 질문으로 강제. 2.5~5.6초 |
| 심사위원 음성(TTS) · 마이크 답변(STT) | ✅ stt-tts `synthesizeSpeech`(Gemini)로 생성하고, 일일 한도가 끝나면 OpenAI로 폴백. 답변은 Live STT로 받아 적음 |
| 세션 저장(SessionRecord) | ✅ `.data/question/sessions/qs_*.json` 6개 모두 `SessionRecordSchema` 통과 |
| 프로바이더 장애 대응 (fix 1차) | ✅ Claude → OpenAI → Gemini(flash 6개 순환) 체인. 오늘 Claude·OpenAI가 모두 막힌 상태에서도 생성 4.5~5초, 꼬리질문 3.3~6.6초. 모두 실패하면 짧은 한국어 오류 + **저장된 실행 불러오기**(AI 호출 없음) |

> ⚠ **HIL 전에 확인할 것 (2026-11-12 기준)**: Claude 키는 2026-12-01까지 사용 한도, **OpenAI는 크레딧 소진(충전 필요)**. 지금은 Gemini 무료 등급 하나로 동작하며, 무료 등급은 분당·일일 한도가 작아 여러 번 연속 생성하면 429/503이 납니다. 안정적인 HIL을 하려면 **OpenAI 크레딧 충전**(또는 Claude 한도 복구)이 필요합니다. 막혔을 때는 화면의 "저장된 실행 불러오기"로 질문·근거·인스펙터·질의응답 UI를 확인할 수 있습니다.

---

## 1. 아키텍처와 데이터 흐름

```
입력: 상황 · 질의응답 시간 · 발표 전사(TranscriptSentence[]) · 발표자료/제안자료 위키 docId · 심사위원 1~3명(성향·이름·성별·나이·얼굴)
  │   (전사 출처: 샘플 세션 46문장 | 대본 54문장 | 마이크 Live STT(useSentenceTranscriber) | 직접 입력)
  ▼
buildContext()  ── LLM 없음(결정적). 위키 lint만 캐시된 LLM 결과 사용
  ① 전사 → 주장 문장 추출: 숫자·사업 키워드 점수 상위 6개(필러 제거, 비슷한 주제 제외)
  ② 위키 질의: (주장 6 + "주요 수치" + "리스크") × 문서 2개 = 16건
     queryWiki(selector:"lexical", includeRaw:false)로 질의하고, 위키 섹션을 slug 단위로 중복 제거한 뒤 문서별 예산(발표 3k/제안 5k자) 안에 담음
  ③ 교차 검토
     · 주요 수치 결정적 비교(getKeyNumbers ×2: metric 이름 bigram 유사도 0.6 이상이고 단위가 같은데 값이 3% 넘게 다름)
     · lintWiki(proposal, {against: presentation})의 cross-doc-mismatch/contradiction/gap(high·medium)
       → .data/question/lint/에 캐시(처음 1회 11.7초). /question을 열면 백그라운드에서 미리 실행
  ④ 검토 포인트(FocusTarget) t1..t12: 불일치 > 근거 공백 > 수치 차이 > 발표 주장
  ⑤ 근거용 원문 쪽: 작은 문서(6k자 이하, 피치덱)는 원문 전체, 큰 문서는 수치·키워드·포인트 인용 쪽 점수 상위 6쪽(쪽당 1.9k자)
  → ContextPack.text (약 26k자 ≈ 16k 토큰): 모든 심사위원 호출에 똑같이 들어가는 앞부분(prefix)
  ▼
generateQuestions()
  · 질문 수: 질의응답 시간 ÷ 55초(질문 TTS 10초 + 답변 35초 + 전환) → 3분이면 본질문 3개. 심사위원마다 ceil(본질문/인원)+1개 생성(나머지는 예비)
  · 검토 포인트 배정: 라운드로빈 그리디(성향 affinity × 심각도). 공격적은 불일치·공백, 빡셈은 수치 차이·불일치, 친절함은 발표 주장·공백을 우선 받음
    프롬프트에 "다른 심사위원이 맡은 포인트"를 넣어 중복을 막음
  · 심사위원별 병렬 스트리밍 호출: 시스템 = [공통 규칙 + ContextPack] (캐시 prefix) + [성향 페르소나] / 사용자 = [배정 포인트, 피할 질문]
    zod 구조화 출력 {question, intent, targetClaim, targetId, evidence[{doc,page,quote}], difficulty}
    스트리밍 중 "question" 필드를 부분 파싱해 delta 이벤트로 보냄(UI 타자 효과)
  · groundEvidence(): 인용을 정규화(NFKC, 공백 제거)한 뒤 raw 쪽 문자열에 포함되는지 확인. 다른 쪽이나 다른 문서에 있으면 쪽 번호를 보정하고, 못 찾으면 verified:false
  · orderQuestions(): 심사위원 순서대로 라운드로빈. 비슷한 질문(유사도 0.5 초과)이나 같은 targetId는 예비 질문으로 내림
  → QuestionRun을 .data/question/runs/<runId>.json에 저장. NDJSON 이벤트: stage | context | plan | delta | question | judge-done | done | error
  ▼
질의응답(UI)
  질문 → POST /api/question/tts(심사위원 음성: 성별·나이·성향) → 재생 → 답변(입력 또는 마이크 Live STT)
     음성 재생은 "티켓"으로 관리: 다음 질문·건너뛰기·답변 제출·마이크 켜기·멈춤이 티켓을 무효화하므로, 늦게 도착한
     이전 질문의 음성은 버려지고 마이크가 켜져 있는 동안에는 어떤 음성도 재생하지 않음
  → followUp(): 같은 컨텍스트 + 대화 스레드 + 남은 시간 + 꼬리질문 한도(친절함 1, 빡셈·공격적 2) + 이후 예정 질문 목록
     → {assessment{score, verdict 충분/부분/회피/부정확, reason}, decision followup|next, remark, followup?, attemptId, guard?}
     꼬리질문이면 같은 심사위원이 "remark + 꼬리질문"을 한 번의 음성으로 말함. next면 다음 질문으로 넘어감
     · 질의응답 세션(QAAttempt, a_…): "질의응답 시작"마다 새 id. 스레드·꼬리질문 횟수·꼬리질문·QA 로그는 이 세션 안에서만 이어지고
       .data/question/attempts/<runId>/<aid>.json에 저장. 저장된 run JSON은 생성 뒤 바뀌지 않음(재생해도 이전 세션이 섞이지 않음)
     · 서버 가드(lib/guards.ts): 한도·시간 부족 → next / verdict "충분" → next / 꼬리질문이 아직 안 한 예정 질문과 겹치면
       (질문 유사도 > 0.45, targetClaim 유사도 > 0.6, 이 주제에 없던 수치 2개 이상이 예정 질문과 일치) → next.
       remark는 40자 안의 문장 단위로 자르고, 첫 문장부터 길면 성향 기본 반응("알겠습니다." 등)으로 바꿈. judgeId가 질문 주인과 다르면 400
  → 세션 저장: SessionRecord(lib/types) + meta(질문·근거·평가·attemptId)를 .data/question/sessions/
```

### 성향 페르소나 (`lib/personas.ts`)

| 성향 | 시스템 프롬프트 요지 | 난이도 | 꼬리질문 한도 |
|---|---|---|---|
| 친절함 | 좋았던 점을 짧게 인정한 뒤 열린 질문을 함. 설명이 부족한 곳을 더 듣고 싶다고 함. 빈 칭찬은 하지 않음 | 1~3 | 1 |
| 빡셈 | 감정 표현 없이 수치의 출처·계산·정합성을 요구함. "어느 쪽이 맞습니까", "근거가 무엇입니까" | 3~4 | 2 |
| 공격적 | 가정에 정면으로 도전하고 모순을 지적하며 최악의 시나리오를 물음. "~ 아닙니까?" 다만 인신공격·비하·조롱은 금지 | 4~5 | 2 |

공통 규칙: 구어체 존댓말 1~2문장, 120자 이내, 질문 하나에 검증 포인트 하나. quote는 `[원문 …]` 블록이나 `[전사 …]` 줄에서 그대로 복사하고, 위키 요약 문장은 쓰지 않음. STT 동음이의 오류(완충제/완충재)는 문제 삼지 않음.

## 2. 사용 모델과 이유

| 용도 | 1순위 | 실제 사용(오늘) | 이유 |
|---|---|---|---|
| 질문 생성 | **Claude `claude-sonnet-5-5`** (adaptive thinking, effort low, 스트리밍, `fallbacks:"default"`, 공통 컨텍스트에 `cache_control`) | 빌더 단계: **OpenAI `gpt-5.5`**(reasoning low, strict json_schema). 크레딧 소진 후: **Gemini flash 체인**(`gemini-3.8-flash`…, thinking LOW, `responseJsonSchema`) | 발표가 끝나자마자 질문해야 하므로 지연이 중요함. Sonnet 5.5는 짧고 근거가 있는 질문에서 Opus에 가까운 품질을 내면서 심사위원당 몇 초가 빠름. 질문 수가 적고 컨텍스트가 길어 출력 품질이 중요하므로 OpenAI 폴백도 상위 모델(gpt-5.5)을 씀 |
| 꼬리질문 판단 | Claude `claude-sonnet-5-5`(effort low) | 빌더 단계: **OpenAI `gpt-5.4-mini`**. 크레딧 소진 후: Gemini flash 체인(3.3~6.6초) | 발표자가 기다리는 구간. 2.5~5.6초. 답변 평가와 수치 대조 품질은 아래 검증 결과 참고 |
| 심사위원 음성 | stt-tts `synthesizeSpeech`(Gemini TTS 4개 모델 체인) | 오늘은 한도가 끝나 **OpenAI `gpt-4o-mini-tts`** 폴백 | 같은 페르소나 스타일 지시문(`styleFor`)을 쓰고, 목소리는 성별×성향(남: cedar/onyx/ash, 여: coral/sage/marin)으로 매핑. 2.7~3.0초, 디스크에 캐시 |
| 답변 STT | stt-tts `useSentenceTranscriber({phase:"qa"})` | Gemini Live `gemini-3.5-transcribe-live` | 확정까지 약 1.5초, 문장 단위 |

- **프로바이더 체인**(`lib/llm.ts` + `lib/providers.ts`, `auto` 기본): **Claude Sonnet 5.5 → OpenAI → Gemini**.
  - 계정 문제(Claude 사용 한도, OpenAI 크레딧 소진, 키 오류)는 `billing`으로 분류해 그 프로바이더를 프로세스 전체에서 건너뜀. OpenAI는 10분마다, Claude는 한도 해제일까지(최대 6시간 간격) 다시 시도하므로 충전 후 서버를 재시작할 필요 없음.
  - 일시 오류(429 rate limit, 529 overloaded, 5xx, 연결 실패)와 잘못된 JSON은 **그 호출만** 다음 프로바이더로 넘김. (리뷰 지적: 예전에는 Claude 429/529면 폴백 없이 실패했음)
  - Gemini는 `gemini-3.8-flash → 3.7-flash → 3-flash-preview → 3.5-flash → 3.6-flash → 3.1-flash-lite` 순으로 돌림(모델마다 무료 한도가 따로 있음). 구조화 출력(`responseJsonSchema`, thinking LOW)을 스트리밍하고, 모델별로 첫 토큰 15초·전체 60초 제한, 429는 retryDelay만큼 쉼. 실측(26k자 컨텍스트, 질문 2개): 3-flash-preview 5.5초, 3.1-flash-lite 6.4초, 3.5-flash 6.7초, 3.6-flash 10.4초.
  - 전부 실패하면 `ProvidersUnavailableError`: "AI 모델을 지금 쓸 수 없습니다 — Claude 사용 한도 초과(2026-12-01 재개) · OpenAI 크레딧 소진(충전 필요) · Gemini 무료 한도 초과(429)…" 같은 짧은 한국어 메시지만 UI로 보냄(긴 결제 URL 제거).
  - UI 라벨 예: `gemini:gemini-3.8-flash (비활성 claude: 사용 한도 초과(2026-12-01 재개), openai: 크레딧 소진(충전 필요))`.
  - `QUESTION_LLM_PROVIDER=claude|openai|gemini`로 고정, `QUESTION_OPENAI_MODEL` / `QUESTION_OPENAI_FOLLOWUP_MODEL`로 OpenAI 모델 변경.
  - **Claude 경로는 tsc를 통과했지만 실호출로는 검증하지 못함**(요청 형태는 현재 문서와 일치: beta stream, `server-side-fallback-2026-07-01` + `fallbacks:"default"`, adaptive thinking, `output_config.effort/format`).
- **TTS 체인**(`lib/tts.ts`): stt-tts `synthesizeSpeech` → 429면 **Gemini 직접 재시도**(stt-tts의 persona·wav 헬퍼를 그대로 쓰고 쿨다운·캐시만 따로 둠; stt-tts는 일일 한도 429 뒤 몇 시간짜리 쿨다운을 메모리에 들고 있어서, 한도가 풀린 뒤에도 서버 재시작 전까지 거부했음) → OpenAI `gpt-4o-mini-tts`(OpenAI가 막혀 있으면 건너뜀). 모두 실패하면 503과 "심사위원 음성을 만들 수 없습니다 (…). 질문은 텍스트로 진행하세요."
- 프롬프트 캐시: 공통 prefix(규칙 + 컨텍스트, 약 18k 토큰)가 같아서 OpenAI 자동 캐시가 둘째·셋째 심사위원 호출에서 17,152 토큰을 재사용함(측정값).

## 3. 라우트 / API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/question` | PoC 화면 |
| GET | `/api/question/setup` | 샘플 입력(상황·전사 46문장·심사위원 3명), 대본 전사 54문장, 위키 문서 목록, 생성된 심사위원 얼굴(judge PoC), 기본 docId. 기본 문서쌍의 lint도 백그라운드에서 미리 실행 |
| POST | `/api/question/setup` | `{action:"ingest-fixtures"}`: 픽스처 PDF 2개를 `ingestPdf`로 인제스트(해시로 재사용하면 즉시 끝남) |
| POST | `/api/question/generate` | `GenerateInput` → `application/x-ndjson` 스트림(`GenerateEvent`) |
| POST | `/api/question/retry` | `{runId, judgeIds?}` → NDJSON(`GenerateEvent`). 생성이 실패한 심사위원(기본: 질문 0개인 심사위원)만 저장된 컨텍스트로 다시 만들어 같은 run에 합치고 라운드로빈 순서를 다시 짬 |
| POST | `/api/question/followup` | `{runId, judgeId, questionId, answer, remainingSec?, attemptId?, thread?}` → `FollowUpResult`(+`attemptId`, `guard?`). attemptId가 없으면 새 세션을 만들어 돌려줌 → 다음 호출부터 그대로 넘김. judgeId가 질문 주인과 다르면 400 |
| POST | `/api/question/tts` | `{text, gender, age, temperament}` → `audio/wav` + `x-provider`, `x-voice`, `x-model`, `x-cache`, `x-duration`, `x-ms` |
| GET/POST | `/api/question/sessions` | 목록 / `{runId, attemptId?, qa[]}` 저장 → `{id, file}` (qa가 비어 있으면 그 attempt의 로그 사용). run은 수정하지 않음 |
| GET | `/api/question/sessions/{id}` | `{record: SessionRecord, meta}` |
| GET | `/api/question/runs` | 저장된 실행 요약 목록(최신순 30개): "저장된 실행 불러오기"용. `complete`, `failedJudges`, `attempts` 포함 |
| GET | `/api/question/runs/{id}[?attempt=a_…]` | `QuestionRun`(ContextPack, 질문) [+ `attempt`: 그 질의응답 세션의 꼬리질문·QA 로그] |

입력은 모두 zod로 검증함(400 + issues). 키는 서버에서만 씀(`lib/ai.ts`).

## 4. 재사용 lib API (`@/question/lib`, server-only)

```ts
import { buildContext, generateQuestions, followUp, saveSession, groundEvidence, loadRun, loadSession, listSessions,
         plannedQuestionCount, assignTargets, orderQuestions, PERSONAS } from "@/question/lib";
import type { GenerateInput, QuestionRun, GeneratedQuestion, ContextPack, FollowUpResult, GenerateEvent, QJudge } from "@/question/lib/types"; // client-safe

const pack = await buildContext(input);                                  // ContextPack (text + 인스펙터 메타)
const run  = await generateQuestions(input, { onEvent: (e) => send(e), signal, pack? });  // QuestionRun (.data/question/runs)
const fu   = await followUp({ runId, attemptId, judgeId, questionId, answer, remainingSec }); // FollowUpResult(+attemptId), attempt 파일에 추가
const fixed = await retryJudges(runId, judgeIds?, { onEvent });           // 실패한 심사위원만 다시 생성(같은 run)
const att  = await loadAttempt(runId, attemptId);                         // QAAttempt {followups, qa}
const { id, record } = await saveSession(runId, qaLog?, attemptId?);      // SessionRecord → .data/question/sessions/<id>.json
clampRemark(text, temperament); duplicateOfPending(followup, topicText, pending); // 순수 가드(lib/guards.ts, 클라이언트에서도 사용 가능)
const runs = await listRuns();                                            // RunSummary[] (재생/디버그용)
// 오류 처리: ProvidersUnavailableError(모든 LLM 실패), friendlyError(e) → UI에 그대로 보여 줄 짧은 한국어 문장
```

- `GenerateInput`: `{ situation, qaMinutes, transcript, presentationDocId?, proposalDocId?, judges: QJudge[] (1–3, gender/age 필수, **id 중복 불가**), fastContext?, questionCount?, avoidQuestions? }`
- `FocusTarget.unverifiedNumbers?`: 위키 lint(LLM)가 쓴 검토 포인트에 원문·전사 어디에도 없는 수치가 있으면 그 목록. detail 끝에 "⚠ 원문에 없는 수치 …: 자동 점검(LLM)이 계산한 값이라 틀릴 수 있음…"을 붙여 심사위원에게 넘기고, 인스펙터에 빨간 태그로 표시함
  - `fastContext`: LLM lint를 건너뛰고 수치 비교만 함(첫 실행 −12초)
  - `avoidQuestions`: "다시 연습"할 때 이전 질문과 다른 각도로 묻게 함
- 판정 기준과 TTS 폴백: `lib/tts.ts` `judgeSpeech()`(stt-tts `synthesizeSpeech`를 감쌈)
- report PoC: `loadSession(id)` → `{record, meta}`. meta에는 질문별 근거·의도·targetId, 답변 평가(verdict/score/reason), 검토 포인트가 있음

## 5. HIL 체크리스트 (사람이 직접 확인)

1. http://localhost:3100/question 을 휴대폰 폭과 데스크톱에서 엽니다. 샘플 상황·전사 46문장·심사위원 3명(이정민 친절함 / 박준호 빡셈 / 최태성 공격적)이 미리 채워져 있는지 확인합니다.
2. "생성된 얼굴 자동 연결"을 누릅니다. 성향이 같은 judge PoC 얼굴로 바뀌는지, 얼굴을 눌러 직접 고를 수 있는지 봅니다. 두 심사위원을 같은 성향으로 두면 이미 쓰는 얼굴은 "사용 중"으로 흐리게 막혀 있어야 합니다.
3. **질문 생성**을 누릅니다. 단계 로그, 심사위원별로 질문이 글자 단위로 스트리밍되는지, 첫 글자·첫 질문·전체 시간을 확인합니다.
4. 질문을 읽어 봅니다. **성향 차이가 귀/눈으로 확실한지**(친절함: 칭찬 + 열린 질문, 빡셈: 건조한 수치 요구, 공격적: "~ 아닙니까?" 압박), 공격적 질문이 무례하지 않은지 봅니다.
5. "근거 N개"를 펼칩니다. 인용문이 정말 그 쪽에 있는지 `p.N` 링크(원본 PDF)로 2~3개 대조합니다. 118원/142원, 340억/210억 불일치를 짚는 질문이 있는지 봅니다.
6. **컨텍스트 인스펙터**에서 섹션별 크기, 검토 포인트(t1…)와 담당 심사위원, 위키 질의 16건, 근거용 원문 쪽, 전체 프롬프트를 확인합니다. 생산능력 포인트(t5 근처)에 "원문에 없는 수치" 빨간 태그가 붙어 있는지 봅니다.
7. **질의응답 시작**을 누릅니다(휴대폰에서). 화면이 타이머·심사위원·질문·답변 칸으로 바로 이동하는지, 심사위원 음성(성별·나이·성향)이 재생되는지, 다시 듣기와 멈춤이 되는지 확인합니다.
7-1. 음성이 나오기 전에(첫 생성은 7~10초) **건너뛰기**를 눌러 봅니다. 이전 질문 음성이 뒤늦게 나오지 않고 새 질문 음성만 나와야 합니다. 음성이 오기 전에 **마이크**를 켜면 심사위원 음성이 재생되지 않아야 합니다.
8. 일부러 **회피성 답변**("기준이 좀 달라서요…")을 입력합니다. 같은 심사위원이 반응(remark)과 함께 꼬리질문을 하는지 봅니다.
9. **근거 있는 답변**(예: "현재 원가는 142원이 맞고 118원은 목표치 오기재…")을 입력합니다. "충분"으로 평가되고 다음 심사위원으로 넘어가는지 봅니다.
10. 마이크 버튼으로 **말로 답변**합니다. "음성 인식 중"으로 글자가 채워지는지, 답변 완료를 누르면 평가되는지 확인합니다.
11. 시간을 1분으로 줄여 다시 해 봅니다. 남은 시간이 45초보다 적으면 꼬리질문 없이 다음으로 넘어가고, 시간이 끝나면 종료되는지 봅니다. "예비 질문 더 받기"도 눌러 봅니다.
12. **세션 저장** 후 "JSON 보기"를 엽니다. SessionRecord(심사위원·전사·qa)가 맞는지 봅니다. "다시 생성"(이전 질문과 다른 각도)을 눌러 질문이 바뀌는지도 확인합니다.
13. 설정 카드 아래 **저장된 실행 불러오기**를 열어 이전 실행을 고릅니다. AI 호출 없이 질문·근거·인스펙터가 채워지고 질의응답을 시작할 수 있어야 합니다. 생성이 실패했을 때는 빨간 오류 카드(한국어, 카드 밖으로 넘치지 않음)의 "최근 저장된 실행 불러오기" 버튼도 같은 일을 합니다.
14. **같은 저장된 실행을 두 번 불러와** 각각 질의응답을 시작하고 첫 질문에 회피성 답변을 넣어 봅니다. 두 번 모두 꼬리질문이 나와야 하고, 평가 이유에 이전 세션의 답변 이야기("앞선 답변을 번복…")가 나오면 안 됩니다. 질의응답 기록 위에 세션 id(`a_…`)가 매번 다르게 보입니다.
15. 생성 중 일부 심사위원이 실패하면(또는 목록에서 "일부 실패" 표시된 실행을 불러오면) 오류 카드에 **실패한 심사위원 다시 생성 (N명)** 버튼이 보이는지, 누르면 그 심사위원 질문만 추가되고 오류 카드가 사라지는지 봅니다. "최근 저장된 실행 불러오기"는 일부 실패한 실행보다 완전한 실행을 고릅니다.
16. 마이크를 켜고 아무 말도 하지 않습니다. 6초 뒤 "N초째 인식된 음성이 없습니다(입력 레벨 …%)" 안내가 나오고, 그대로 답변 완료를 누르면 빈 답변이 제출되지 않고 안내가 떠야 합니다.
17. 근거 있는 답변 뒤에 같은 심사위원이 **이미 예정된 다른 주제**(예: 마진 14% vs 28%)로 넘어가는 꼬리질문을 하지 않는지 봅니다. 서버가 막았다면 평가 줄 아래에 "서버 판단 보정: …"이 보입니다.

## 6. 검증 결과 (2026-11-12, 실호출)

모든 명령은 `pocs/`에서 실행했습니다. 샘플은 `question/samples/`, 스크린샷은 `.verify/question/`에 있습니다.

| 검증 | 명령 | 결과 |
|---|---|---|
| 타입/린트 | `pnpm exec tsc --noEmit \| grep question` · `pnpm exec eslint question app/question app/api/question` | 0 오류 / 0 경고 |
| 질문 생성 ×6 | `node question/tests/generate.mjs <tag> [--judges …] [--fast] [--avoid …] [--proposal …]` | `smoke`, `tones-run1`, `tones-run2`(같은 컨텍스트 2회), `vary-run3`(avoid), `two-strict`(빡셈 2명 + 공격적, fast), `large-128p`(128쪽 제안서, 콜드 lint 11.7초). 컨텍스트가 캐시돼 있으면 전체 6.1~10.9초, 첫 delta 1.9~2.7초, 심사위원당 5.1~8.9초, 입력 18k 토큰(캐시 17,152), 출력 330~840 토큰 |
| 자체 평가 | `node --env-file=.env.local question/tests/assess.mjs question/samples/{smoke,tones-run1,tones-run2,vary-run3,two-strict}.json` → `samples/assessment.json` | **근거 72/72** 원문 일치(서버 플래그를 믿지 않고 `/api/wiki/.../raw/N`으로 다시 검사). 약점 탐지: unit-cost 8, som 5, growth-capacity 3, single-supplier 3. 성향 지표(친절함/빡셈/공격적): 평균 난이도 2.75/3.83/4.5, 칭찬 표현 0.88/0/0, 압박 표현 0/0/0.8, 근거 요구 0.5/0.83/0.2. **블라인드 분류 93%**(gpt-5.4-mini, 30문항: strict 12/12, friendly 7/8, aggressive 9/10). 심사위원 간 최대 유사도 0.11~0.29, 중복 targetId 0 |
| 꼬리질문 루프 | `node question/tests/followup.mjs question/samples/{smoke,tones-run1}.json` → `samples/*-followup.json` | 회피 답변 → **followup**("그 기준 차이가 정확히 뭡니까? 118원과 142원 중…", 3.7초). 그 꼬리질문에 강한 답변 → **next, 충분 5/5**(2.5~3.1초). SOM에 강한 답변 → next, 충분 4/5. remainingSec 20 → 강제 next. 꼬리질문 근거도 원문 ✓ |
| TTS | 위 스크립트, curl | Gemini(Algenib/Schedar, `gemini-2.5-flash-preview-tts`) 200 WAV, 처음 생성 7.0~9.0초, 캐시 1ms. 한도가 끝난 뒤 OpenAI 폴백 200 WAV(coral 7.45초 분량) 2.7~3.0초. `node --env-file=.env.local question/tests/tts-roundtrip.mjs` 왕복 전사 1.0 / 0.84(STT의 "뒷받침하는→디봤지만은" 오인식) |
| 브라우저 E2E | `node question/tests/ui.mjs mobile` · `desktop` · `mobile --mic` | 로드 1.0~2.0초 → 첫 partial 1.9~3.0초 → 생성 6.7~10.7초 → QA 시작 + TTS 200 → 회피 답변 → 꼬리질문(3.1~4.9초) → 강한 답변 → "부분 3/5", 다음 질문 → 세션 저장. **콘솔 오류 0, 가로 넘침 0**. `--mic`: 가짜 마이크(answer-ko-16k.wav)를 Live STT로 받아 적음("네. 지금 원가가 스티로폼보다 높은 건 맞습니다…") |
| 세션 스키마 | `node question/tests/check-session.mjs` | `.data/question/sessions/qs_*.json`이 `SessionRecordSchema`(fixtures/lib)를 모두 통과 |

스크린샷:
- 모바일: `.verify/question/mobile/1-setup.png`, `2-streaming.png`, `3-generated.png`, `4-evidence.png`, `5-inspector.png`, `6-qa.png`, `8-after-answer1.png`, `9-log-saved.png`
- 데스크톱: `.verify/question/desktop/*`
- 마이크 답변: `.verify/question/mobile-mic/7-mic-listening.png`

### 6-1. 리뷰 수정 1차 검증 (2026-11-12, fix:question)

| 리뷰 이슈 | 고친 내용 | 검증 (명령 → 결과) |
|---|---|---|
| [major] 모바일에서 질의응답 시작 후 QA 영역이 화면 밖 | `startQa`·예비 질문 재개(`addReserve`) 때 타이머+QA 영역으로 `scrollIntoView`. 휴대폰에서는 심사위원 영역을 16:9(데스크톱 2:1)로 줄여 답변 칸까지 한 화면에 들어오게 함 | `node question/tests/review-scroll.mjs mobile` → 고치기 전 `qaStageTop:-1026, answerTop:-373` → 고친 뒤 **`qaStageTop:156, answerTop:744`**(뷰포트 844). 실제 탭으로 확인: `.verify/question/fixes/mobile-real-flow/3-after-start.png` |
| [major] 늦게 도착한 TTS가 새 질문을 끊고 재생, 마이크 켠 동안 재생 | `speak()`에 티켓(`speakSeq`)과 `micOnRef`. ask/건너뛰기/답변 제출/마이크 켜기/멈춤/다시 생성이 `cancelSpeech()`로 티켓을 무효화. 도착한 음성은 티켓이 같고 마이크가 꺼져 있을 때만 재생. 상태 표시(질문 중)도 현재 티켓만 바꿈 | `node question/tests/review-ui.mjs mobile stale-audio …gen1-real.ndjson`(첫 TTS 5초 지연) → 고치기 전 `plays=[q2, q1]` → 고친 뒤 **`plays=[q2만]`, lastPlayedIsQ1=false**. `… mic-during-tts` → 고치기 전 마이크 켠 채 재생 → 고친 뒤 **`plays=[]`, micStillOn=true** |
| [major] 모든 프로바이더 소진 시 HIL 불가 | Gemini LLM 폴백(6개 모델 순환), 계정 문제는 프로세스 단위로 건너뛰고 주기적으로 재확인, TTS는 Gemini 직접 재시도 추가, 짧은 한국어 오류, **저장된 실행 불러오기**(`GET /api/question/runs` + UI), 오류 카드 줄바꿈 | `curl -X POST /api/question/followup …"기준이 좀 달라서요"` → 고치기 전 500 → **200, 6.6초**(gemini, 회피 1/5 → 꼬리질문, 근거 2개 원문 ✓). `node question/tests/generate.mjs gemini-fallback` → **4.5초**, 질문 6개(gemini-3-flash-preview), 근거 **17/18** 독립 검증 일치(`review-ground.mjs`; 나머지 1개는 서버가 이미 verified=false로 표시). `node question/tests/fixes.mjs mobile real-flow` → 생성 4.95초 → 시작 탭 → Gemini TTS 재생(9.7초) → 회피 답변 → 꼬리질문 3.3초, 콘솔 오류 0, 가로 넘침 0. desktop 동일(Claude 재확인 후 Gemini). `node question/tests/fixes.mjs mobile error-replay`(전부 실패 모의) → 한국어 오류 카드(자식 오른쪽 345 ≤ 카드 366, 넘침 0) → "최근 저장된 실행 불러오기" → 질문 6개 + 인스펙터 표시 |
| [minor] lint 검토 포인트의 틀린 생산능력 계산(30억~49.5억) | lint 메시지 속 수치 중 원문·전사에 없는 것을 `unverifiedNumbers`로 표시하고 detail에 경고 문구를 붙임. 인스펙터에 "원문에 없는 수치 N" 태그 | `gemini-fallback` 실행의 t5: `unverifiedNumbers = [30억, 49.5억, 44.4억, 266.4억, 297억]`, 다른 포인트는 오탐 0. 화면: `.verify/question/fixes/mobile-real-flow/2-inspector-flag.png` |
| [minor] 얼굴 선택으로 심사위원 id 중복 | 다른 심사위원이 쓰는 얼굴은 선택 불가("사용 중"), 선택 시 id가 겹치면 접미사, `GenerateIn`·`generateQuestions`가 중복 id를 거부 | `node question/tests/fixes.mjs mobile dup-face` → 두 번째 피커에서 첫 심사위원 얼굴 `disabled:true`; 중복 id API 호출 → **400 "심사위원 id가 중복됩니다"** |
| [minor] Claude 429/529면 폴백 안 됨 | `classify()`가 타입별 예외(`RateLimitError`, `InternalServerError`(529 포함), `APIConnectionError`)를 일시 오류로 보고 그 호출만 다음 프로바이더로 넘김 | 코드 확인 + tsc. 실호출 재현 불가(Claude 키 한도) |

추가로 고친 것: 모든 심사위원이 실패해 `done` 없이 스트림이 끝나면 화면이 빈 "생성된 질문" 카드에 머물던 문제(이제 설정 단계로 돌아가 오류 카드와 재생 버튼을 보여 줌). 모델 라벨이 길어 모바일에서 "생성된 질문" 제목이 두 줄로 깨지던 문제(라벨을 제목 아래 줄로 옮김).

스크린샷: `.verify/question/fixes/{mobile,desktop}-real-flow/*.png`, `.verify/question/fixes/mobile-error-replay/{1-error,2-replayed,3-inspector}.png`, `.verify/question/fixes/mobile-dup-face/1-picker.png`, `.verify/question/review/mobile-after-start-qa-tap.png`(재측정).
타입/린트: `pnpm exec tsc --noEmit | grep question` 0건, `pnpm exec eslint question app/question app/api/question` 0건.

검증 중 고친 것 (빌더 단계):
- TTS 429가 이어질 때 예비 음성 미리 받기가 무한 재시도하던 문제. 질문당 1회만, TTS 오류가 난 뒤에는 중단하도록 고침
- Gemini 일일 한도가 끝나면 음성이 끊기던 문제. OpenAI 폴백(`lib/tts.ts`)을 추가함
- 모바일 심사위원 카드에서 칩이 줄바꿈되던 문제. 3열 성향 칩으로 고침
- 얼굴 썸네일(256px)이 큰 카드에서 흐리던 문제. `?size=card`(512px)를 씀

### 6-2. 리뷰 수정 2차 검증 (2026-11-13, fix:question)

| 리뷰 이슈 | 고친 내용 | 검증 (명령 → 결과) |
|---|---|---|
| [major] 저장된 실행을 재생하면 이전 세션의 QA가 섞여 꼬리질문이 틀림 | **질의응답 세션(QAAttempt)** 도입. "질의응답 시작"마다 클라이언트가 `a_…` id를 만들고 모든 followup 호출에 보냄(없으면 서버가 만들어 돌려줌). 스레드·꼬리질문 횟수·꼬리질문 질문·QA 로그를 `.data/question/attempts/<runId>/<aid>.json`에만 씀. **run JSON은 생성 뒤 수정하지 않음**(followUp·saveSession 모두). 예전 run에 남은 꼬리질문/QA는 서버·UI가 무시 | `node question/tests/attempts.mjs r_mwdn00iwkin6b`(예전 세션 QA 5건·꼬리질문 2개가 남은 리뷰 재현 run, 실호출 gemini-3.1-flash-lite) → **15/15 PASS**: 리뷰 재현 요청(회피 답변, remainingSec 170)이 고치기 전 `next`("앞선 질문에서 인정한 오류를 번복…") → **`followup` q_…_1_f1, 4.8초**, 평가 이유에 다른 세션 언급 없음 / 새 세션 B도 `_f1`부터 다시 시작 / 세션 A의 꼬리질문은 다른 세션에서 404 / attempt 로그 A=2, B=1 / run 파일 md5 그대로(`1ee26c51`) / attempt B로 세션 저장 → qa=1, meta.attemptId=B. 결과: `question/samples/attempts.json` |
| [minor] '충분' 평가인데 꼬리질문, 예정 질문과 같은 주제 반복 | `lib/guards.ts`: verdict "충분" → next. `duplicateOfPending()`: 아직 안 한 본/예비 질문과 겹치면(질문 bigram 유사도 > 0.45, targetClaim > 0.6, 이 주제에 없던 수치 2개 이상이 예정 질문에 있음) next. 프롬프트에도 "이후 예정된 질문 주제" 목록과 "충분이면 next" 규칙을 넣음. 막은 경우 `guard{kind, detail}`을 응답에 넣고 UI에 "서버 판단 보정"으로 표시 | `pnpm exec jiti question/tests/guards.ts` → **7/7 PASS**: 리뷰 사례(q_…_1_f2 "매출총이익률 14% vs 28%")가 q_judge-strict-1_2의 중복으로 잡힘, 같은 주제(210억/340억) 꼬리질문은 안 잡힘. 실호출: 강한 정정 답변 → `충분 4/5 → next`(attempts.mjs A2) |
| [minor] judgeId가 질문 주인인지 확인 안 함 | `asked.judgeId !== judge.id`면 `FollowUpInputError` → **400** | 리뷰 재현 curl(`judge-friendly-1` + `q_judge-strict-1_2`) → 고치기 전 200 → **400 "이 질문(q_judge-strict-1_2)은 다른 심사위원의 질문입니다"** |
| [minor] 일부 심사위원 실패 시 재시도 불가, '최근 실행'이 부분 실행을 고름 | `retryJudges()` + `POST /api/question/retry`: 질문이 없는 심사위원만 저장된 ContextPack으로 다시 생성(다른 심사위원 질문은 avoid로 넘겨 중복 방지)하고 같은 run에 합친 뒤 라운드로빈 재정렬. UI 오류 카드에 **"실패한 심사위원 다시 생성 (N명)"**(재생으로 불러온 부분 실행에도 표시). `listRuns`에 `complete/failedJudges`, 목록에 "일부 실패(이름)" 표시, `replayLatest`는 완전한 실행 우선 | 부분 실행 복사본 `r_retry96774`(박준호 실패) → `curl -N POST /api/question/retry` → **5.4초**, 박준호 질문 2개 추가, order가 친절함→빡셈→공격적 라운드로빈으로 재정렬, `complete:true`. 브라우저 `node question/tests/fixes-r2.mjs retry r_retryui6823`(2명 실패) → 버튼 표시 ✓(`.verify/question/fixes-r2/retry/01-partial.png`). 이 시점엔 Gemini 일일 한도 소진으로 재시도도 실패 → 오류 카드에 사유와 버튼이 그대로 남음(실패 경로 확인, 콘솔 오류 0, 넘침 0) |
| [minor] 재생 흐름에서 마이크 답변이 전사되지 않고 안내도 없음 | 마이크가 켜진 뒤 6초 동안 인식된 글자가 없으면 **"N초째 인식된 음성이 없습니다 (입력 레벨 x%)"** 안내. 마이크로 답한 결과가 비어 있으면 제출하지 않고 "음성이 인식되지 않았습니다…" 표시(빈 답변이 LLM으로 가지 않음) | `node question/tests/fixes-r2.mjs silent r_mwdmstbff2lhs`(무음 WAV 가짜 마이크) → 안내 표시, 빈 답변 제출 차단, followup 요청 0건, 콘솔 오류 0 (`.verify/question/fixes-r2/silent/01-mic-silent.png`, `02-empty-blocked.png`). **원인 조사**: 리뷰 스크립트(`review-r2-mic.mjs`)를 다시 돌리면 getUserMedia 스트림 RMS가 계속 `0.0000`. 앱 코드가 없는 빈 페이지(/devlog)에서 같은 가짜 WAV(16k·24k 둘 다, 파일 자체 RMS 1519)로 재도 `0.0000` → **현재 헤드리스 Chrome의 가짜 오디오 캡처가 무음을 내는 하네스 문제**이고 재생 흐름과는 무관 |
| [minor] remark 40자 규칙 미적용 | `clampRemark()`: 40자 안에서 문장 단위로 자르고, 첫 문장부터 넘으면 성향 기본 반응으로 바꿈 | guards.ts 테스트: 리뷰 사례(49자) → "정확한 근거 없이 답변하시면 곤란합니다."(22자). 실호출 remark 6~36자 |

브라우저 E2E (Gemini가 잠깐 돌아온 00:29 이후, 실호출):
- `node question/tests/fixes-r2.mjs replay r_mwdn4vohkd6v2`(리뷰가 '회피 1/5 · 다음 질문'을 본 run을 데스크톱에서 **두 번 불러와** 각각 "기준이 좀 달라서요…") → 세션 1 `a_mwdpe474y0a77o`: **회피 1/5 · 꼬리질문**(4.6초), 세션 2 `a_mwdpea5qnft8jv`: **회피 1/5 · 꼬리질문**(3.9초), run 응답 동일(변경 없음), 넘침 0. 콘솔 오류 3건은 모두 `/api/question/tts` 503(Gemini TTS 일일 한도·OpenAI 크레딧 소진). 화면은 "텍스트로 진행" 안내로 계속 진행됨. 스크린샷 `.verify/question/fixes-r2/replay/01-evasive-session1.png`, `02-evasive-session2.png`
- `node question/tests/fixes-r2.mjs retry r_retryui6823`(모바일, 2명 실패한 부분 실행) → 버튼 클릭 → **7.3초** 만에 이정민·최태성 질문이 추가되어 3명 모두 질문 있음, run `complete:true`(질문 6개), 오류 카드 사라짐, 콘솔 오류 0, 넘침 0. 스크린샷 `.verify/question/fixes-r2/retry/01-partial.png`, `02-retried.png`, `02-retried-full.png`
- 먼저 돌린 retry(한도 소진 중)는 재시도도 실패해 오류 카드와 버튼이 그대로 남는 실패 경로를 보여 줌
타입/린트: `pnpm exec tsc --noEmit | grep question` 0건, `pnpm exec eslint question app/question app/api/question` 0건. 세션 스키마 `check-session.mjs` 10/10 통과.

## 7. 알려진 한계

- **Claude 경로 실호출 미검증**(키 한도, 12/1 복구). 오늘 질문은 모두 gpt-5.5 / gpt-5.4-mini로 만듦. 복구되면 `QUESTION_LLM_PROVIDER=claude`로 회귀 테스트하고 Sonnet/Opus 품질·지연을 비교해야 함.
- **11-13 00시 기준 Gemini 무료 등급도 일일 한도 소진**: gemini-3.8/3.7/3.6/3.5-flash 모두 `GenerateRequestsPerDayPerProjectPerModel-FreeTier` 429(재개까지 약 16.5시간), 3.1-flash-lite는 503(수요 과다). 이 상태에서는 생성·꼬리질문·TTS가 모두 실패하고, 화면은 오류 카드 + 저장된 실행 재생 + 건너뛰기로만 진행됨.
- **11-12 기준 실제로 쓸 수 있던 건 Gemini 무료 등급뿐**: Claude 한도(12/1 복구), OpenAI 크레딧 소진. Gemini 무료 등급은 분당·일일 한도가 작고 다른 PoC와 같은 키를 쓰므로, 연속 생성 시 429/503이 섞임. 실제로 `gemini-fallback-2` 실행은 모델 대부분이 429/503이라 52초가 걸렸고 심사위원 1명이 실패함(나머지 2명은 성공). 안정적인 HIL에는 OpenAI 충전이 필요함.
- Gemini 폴백의 질문 품질은 gpt-5.5 기준 assess(블라인드 분류 93%)로 다시 재지 않음(블라인드 분류 스크립트가 OpenAI를 씀). 눈으로 본 결과 성향 차이·근거·약점 탐지(원가·SOM·마진·단일 공급처)는 유지됨.
- Gemini 직접 TTS 재시도는 stt-tts의 메모리 쿨다운을 우회함. stt-tts 쪽에서 쿨다운을 실제 응답으로 다시 확인하게 하면 이 우회는 지울 수 있음(devlog note 참고).
- 저장된 실행 불러오기는 생성 결과만 재생함. 꼬리질문은 여전히 LLM이 필요(모두 막히면 "건너뛰기"로 진행). 재생할 때마다 새 질의응답 세션(attempt)이 만들어지므로 이전 세션과 섞이지 않음.
- 2차 리뷰 이전에 만든 run JSON(`r_mwdn00iwkin6b` 등)에는 예전 세션의 `qa`·꼬리질문이 그대로 남아 있음. 서버와 UI는 이것을 무시함(꼬리질문은 attempt에서만 찾음). report PoC는 sessions/만 읽으므로 영향 없음.
- 꼬리질문 중복 가드는 어휘 휴리스틱(bigram 유사도·수치 토큰)이라, 같은 주제를 전혀 다른 말과 수치 없이 다시 묻는 경우는 못 잡을 수 있음. 프롬프트에도 "예정 질문 주제" 목록을 넣어 1차로 막음.
- "실패한 심사위원 다시 생성"은 run을 제자리에서 고침(그 run의 다른 심사위원 질문 id는 그대로). 테스트용으로 부분 실패 run을 복사한 `r_retry96774`, `r_retryui6823`가 목록에 보임.
- 마이크 무응답 안내는 "인식된 글자가 없음"만 봄. 리뷰어의 재생 흐름 + 가짜 마이크에서 Gemini Live가 아무 이벤트도 보내지 않던 현상의 원인은 확정하지 못함(아래 6-2 참고).
- 같은 입력이면 질문이 거의 같게 나옴(결정적 컨텍스트, 낮은 다양성). "다시 생성"은 `avoidQuestions`로 각도를 바꿈. 무작위 배정이나 seed는 아직 없음.
- 주장 추출과 원문 쪽 선택은 어휘 규칙 기반(숫자·키워드)이라 숫자가 적은 발표(비전·정성 위주)에서는 주장 선택이 약할 수 있음. lint 캐시는 위키를 다시 인제스트해도 무효화되지 않음(PoC).
- 원문 쪽은 PDF 텍스트 레이어에 의존하므로 인용에 줄바꿈이 섞임(UI에서 공백으로 표시). 표·차트 이미지 안의 숫자는 인용할 수 없음.
- 꼬리질문 판단은 LLM 판단이라 "부분/회피" 경계가 실행마다 조금씩 다름. 답변 평가에는 발표자가 자료에 없는 새 사실을 말했는지도 반영됨("원문 근거 부족").
- 질의응답 세션 상태(attempt JSON)는 단일 프로세스·파일 기반임. 같은 attempt에 꼬리질문을 동시에 요청하면 마지막 쓰기가 이김(UI는 답변 검토 중 버튼을 막음).
- 마이크로 발표 녹음(설정의 "마이크로 발표")은 stt-tts Live 세션 한도(10~15분 재연결)를 그대로 따름. 30분 발표는 시험하지 않음.

## 8. 다음 단계

1. Claude 복구 후 Sonnet 5.5와 Opus 5.5의 질문 품질·지연을 측정하고(같은 assess 스크립트), 블라인드 분류·근거율로 비교함. Gemini 폴백 질문도 같은 기준으로 재야 함(assess의 분류기를 프로바이더 체인으로 바꾸기).
2. 실제 앱의 심사 화면: 발표가 끝나는 순간 `generateQuestions`를 시작하고(발표 중 마지막 1분 전사로 미리 시작할 수도 있음), 첫 질문 TTS를 미리 받아 두면 체감 지연은 약 0초.
3. 답변 평가 결과(verdict/score/reason)를 report PoC의 "질문별 평가 근거"에 직접 연결함(meta.qaDetails).
4. 다양성: 검토 포인트 배정 셔플, 성향 내 하위 스타일(재무형/시장형/기술형) 추가.
5. 주장 추출을 LLM 보조로(haiku급 1회) 바꿔 정성 위주 발표 대응. 위키 index mtime으로 lint 캐시를 무효화함.
