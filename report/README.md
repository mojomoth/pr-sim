# report: 리포트 생성

발표 연습 한 회차(`SessionRecord`)로 결과 리포트를 만듭니다. 리포트는 네 부분입니다.

1. **발표 분석(STT)**
2. **질의응답 타당성**
3. **자료 품질**
4. **종합**: 총점과 영역별 점수, 잘한 점, 우선 개선점

- UI: **http://localhost:3100/report**
  - 화면 흐름: 세션 선택 → 생성(섹션별 진행 표시) → 종합 결과 → 상세 피드백(질문별 / 발표 분석 / 자료 품질) → JSON 다운로드
  - 링크로 바로 열기: `?session=<ref>&view=result|detail&tab=qa|speech|materials`
  - 예시: http://localhost:3100/report?session=sample%3Asession-bad&view=result
- 근거 자료는 wiki PoC(Karpathy LLM Wiki)의 `queryWiki`, `lintWiki`, `getKeyNumbers`, raw 쪽 원문을 씁니다.

## 핵심 설계

| 원칙 | 구현 |
|---|---|
| **결정적 지표는 LLM에 맡기지 않음** | `computeSpeechMetrics()`는 순수 함수입니다. 계산 항목: 말 속도(음절/분, 문장/분), 군말(간투사·습관어) 횟수와 비율·예문, 평균/최장 문장 길이, 반복 표현, 긴 침묵, 시간 사용률. 결과로 전달 점수(0–100)와 감점 사유를 냅니다 |
| **판단만 LLM, 루브릭 고정** | 섹션마다 점수 구간(90+ 탁월 / 75 양호 / 60 보통 / 40 미흡 / 0–39 부적절)과 항목 정의, 상한 규칙을 프롬프트에 명시했습니다. 상한 규칙의 예: 자료와 모순되는 수치면 정확성 40 이하. 출력은 zod 스키마로 구조화합니다 |
| **병렬** | 발표 내용 분석, 질문 N개, 덱, 제안서, 수치 대조를 모두 동시에 돌립니다(QA는 최대 6개 동시). 종합 코멘트만 마지막에 1회 호출합니다. LLM 호출은 질문 4개 기준 총 9회입니다 |
| **점수는 코드가 집계** | 아래 "점수 계산" 참고. LLM은 하위 항목 점수만 매기고, 가중 평균·감점·총점은 코드가 계산합니다. 종합 LLM은 점수를 바꿀 수 없고 문구만 씁니다 |
| **쪽 번호 재근거화** | LLM이 낸 모든 인용(`refs[{doc,pages,quote}]`)을 불변 raw 원문에서 다시 찾습니다(`groundRef`). 수치는 그 값이 있는 쪽으로 고치고, 문장은 단어가 60% 이상 겹치는 쪽으로 고칩니다. 확인되면 `grounded:true`이고, UI에서는 미확인 칩을 점선으로 표시합니다 |
| **미완성 리포트는 만들지 않음** | 평가 대상 섹션(발표 분석·질문별·문서별·수치 대조·종합) 중 하나라도 실패하면 리포트를 만들지 않고 `error`로 끝냅니다(`ReportIncompleteError`). 점수도 매기지 않고 캐시에도 쓰지 않습니다. 그래서 실패한 "다시 생성"이 기존 정상 리포트를 덮어쓸 수 없습니다. 저장은 `.tmp` → `rename`으로 원자적으로 합니다. 이미 성공한 섹션은 메모리(`globalThis`, 2시간)에 남겨 두었다가, 같은 세션 내용으로 다시 시도할 때 재사용합니다(`meta.reusedSteps`) |
| **캐시·중복 방지** | 키는 `sha256({REPORT_VERSION, session})`입니다. 저장 위치: `.data/report/reports/<key>.json`(같은 세션 재요청 시 19ms에 캐시 응답), wiki lint 결과는 `.data/report/lint/`(wiki 갱신 시각을 키로 사용). 진행 중인 작업은 `globalThis` 레지스트리에 있어 같은 세션을 동시에 요청해도 한 번만 계산하고, HMR에도 유지됩니다 |

## 데이터 흐름

```
SessionRecord (fixture / .data/question/sessions / 붙여넣기 / report/samples)
 ├─ ① metrics (코드, <1ms) ─────────────────────────────── 전달 점수
 ├─ ② resolveDocs: presentationDocId/proposalDocId → wiki. 없으면 fixtures PDF를 ingestPdf (재사용 즉시)
 ├─ ③ lint: cachedLint(제안서 vs 덱), lint(덱), lint(제안서)   (첫 회 ~16s, 이후 0s)
 ├─ ④ 병렬 LLM ─┬ speech: 전사[i] + 덱 raw 전문 + 양쪽 주요 수치 → 구조/명료성/설득력, 슬라이드 커버리지, 발표 중 수치 오류
 │              ├ qa×N : 질문+답변 → queryWiki(제안서, 5k자)·덱 raw·문서 간 lint·발표 발췌 → 5개 항목 점수, 모순, 개선 답변
 │              ├ doc×2: 덱 raw 전문 / 제안서 wiki overview+주제 페이지(28k자, 전문 100k자 대신) + 주요 수치 + lint
 │              └ consistency: 양쪽 keynumbers 짝짓기 → 지표별 일치/불일치 표 (쪽 번호를 raw로 재검증)
 ├─ ⑤ groundRef 재근거화 → 점수 집계(코드) → overall LLM(헤드라인·한 줄 평·잘한 점·우선 개선점 3)
 └─ ⑥ 모든 섹션 성공 시에만 .data/report/reports/<key>.json 원자적 저장(meta.complete=true) + NDJSON `done`
     하나라도 실패 → 저장 없이 NDJSON `error{error(한국어), failedSteps, retryable}`, 성공한 섹션은 재시도용으로 메모리에 보관
```

## 사용 모델과 이유

- **기본은 Claude `claude-opus-5-5`입니다.**
  - 설정: adaptive thinking, effort high(수치 대조는 medium), `output_config.format` json_schema, 스트리밍 + `finalMessage()`
  - 서버 측 거절 폴백을 켰습니다(`server-side-fallback-2026-07-01`, `fallbacks:"default"`).
  - 판단 품질이 리포트의 핵심이고, 9회 병렬 호출이라 전체 시간은 가장 느린 호출 한 번이 정합니다.
- **폴백 체인 (호출마다): Claude opus-5-5 → OpenAI gpt-5.5 → Gemini** `gemini-3.8-flash → 3.7-flash → 3.6-flash → 3.5-flash → 3.5-flash-lite → 3.1-flash-lite`
  - Gemini 무료 등급은 **모델별 일일 한도(요청 20회)** 가 따로 있어서 여러 모델을 차례로 씁니다(`REPORT_GEMINI_MODELS`로 변경). lite 모델은 마지막 수단입니다.
  - 오류는 분류합니다(`classifyError`). **쿼터·결제·인증 오류는 최종 오류**라서 재시도하지 않고 그 모델을 30분 동안 "down"으로 표시합니다. 그 뒤 병렬·후속 호출은 그 모델을 바로 건너뜁니다. 분당 한도(429 + 짧은 retryDelay)·5xx·연결 오류는 백오프 후 재시도하고(Gemini retryDelay 준수), 형식 오류는 1회 재시도합니다. SDK 자체 재시도는 끕니다(`maxRetries: 0`).
  - 원문 공급자 오류(영문, 결제 URL 포함)는 서버 로그(`[report/llm]`)에만 남기고, 화면에는 한국어 요약만 보냅니다. 예: "AI 채점 모델을 모두 쓸 수 없어요 — Claude 사용 한도 초과 · OpenAI 크레딧 소진 · Gemini 일일 한도 초과".
  - 리포트 `meta.provider`에 실제로 쓴 모델과 호출 수가 기록됩니다. 예: `gemini:gemini-3.6-flash ×4, gemini:gemini-3.5-flash-lite ×2, … (Claude 사용 한도 초과 · OpenAI 크레딧 소진 → 폴백)`. `meta.usage.byModel`에도 남습니다.
  - 한 공급자로 고정하려면 서버 환경변수 `REPORT_LLM_PROVIDER=claude|openai|gemini`, 요청 단위로는 `POST /api/report/generate {provider}`를 씁니다.
  - 현재 모델 상태(이 서버 프로세스가 실제 호출에서 확인한 down 표시)는 `GET /api/report/health`로 봅니다. 이 엔드포인트는 호출을 하지 않으므로 쿼터를 쓰지 않습니다.
- **2026-11-12 23:00 KST 상태 (`node --env-file=.env.local report/tests/probe-providers.mjs`):**
  - Claude(opus·sonnet 5.5): 400 "usage limits … regain access on 2026-12-01"
  - OpenAI gpt-5.5: 429 크레딧 소진
  - Gemini 3.8/3.7-flash: 429 일일 무료 한도. 3.6-flash, 3.5-flash, 3.5-flash-lite, 3.1-flash-lite는 응답했으나 아래 검증 생성 2회 동안 3.6/3.5-flash도 일일 한도에 도달
  - **Claude 경로는 아직 실호출로 검증하지 못했습니다.** 요청 형식은 claude-api 문서와 SDK 타입 기준이고 tsc를 통과합니다.
- 스키마는 min/max/int 제약을 쓰지 않습니다. 세 공급자의 구조화 출력이 모두 받아들이게 하려는 것이고, 범위 제한(clamp)은 코드에서 합니다.

## 점수 계산 (코드)

| 점수 | 식 |
|---|---|
| 전달 점수 | 100에서 감점: 말 속도 340 초과 시 (spm−340)/4(최대 25), 240 미만 시 (240−spm)/4(최대 20) / 군말 분당 2회 초과 시 (fpm−2)×4(최대 25) / 시간 85% 미만 시 (0.85−u)×60(최대 20), 102% 초과 시 (u−1.02)×100(최대 25) / 3초 이상 침묵 1회당 2(최대 10) / 평균 문장 45음절 초과 시 (평균−45)/2(최대 10) / 더듬기 1회당 1(최대 5) |
| **발표력** | 0.5·전달 점수 + 0.25·명료성 + 0.25·설득력 |
| **논리성** | 0.6·발표 구조 + 0.4·자료 논리 평균 − 발표 중 수치 오류(high 5, medium 2, 최대 15) |
| **대응력** | 질문별 점수 평균. 질문 점수 = 0.25 관련성 + 0.25 정확성 + 0.2 근거 + 0.2 완결성 + 0.1 태도 |
| **자료 품질** | 문서 점수 평균. 문서 점수 = 0.2 구성 + 0.25 논리 + 0.25 근거 + 0.2 일관성 + 0.1 명료성 |
| **총점** | 발표력 25% + 논리성 25% + 대응력 30% + 자료 품질 20%. **세션에 입력 자체가 없는 영역만** 빼고 가중치를 다시 맞춥니다(예: 질문이 0개 → 대응력 제외). 이때 `overall.excluded`에 사유가 남고 점수 카드 아래에 "…은 총점에서 빠졌어요"를 표시합니다. LLM 실패로 영역이 비는 경우는 재정규화하지 않고 리포트 자체를 만들지 않습니다 |

말 속도 계산:

- 음절 수 = 한글 음절 + 숫자 1자당 1 + 영문 0.7 + `%`→3.
- 조음 속도는 연속한 문장 쌍의 `음절/(t₍ᵢ₊₁₎−tᵢ)`에서 75분위값을 쓰고, 4–9음절/초로 제한합니다. 문장 시작 시각만 있으므로 쉼 없이 이어진 문장 쌍이 실제 속도를 알려 줍니다.
- 문장 길이 = 음절 수 / 조음 속도.
- 긴 침묵 = 다음 문장 시작 − 이 문장 끝 ≥ 3초.
- 분석 대상은 `phase:"presentation"` 문장뿐입니다. 발표 단계 전사가 없으면 0문장으로 처리하고(질의응답 답변을 발표로 채점하지 않음), 발표력은 총점에서 제외됩니다. 발표 전사와 질문이 둘 다 없으면 생성 자체를 거절합니다.
- **말 속도에서는 긴 침묵을 뺍니다.** 침묵이 서두른 발화를 가리지 않게 하려는 것입니다.

군말:

- 간투사(`음/어/아/에/으/흠/엄`)는 단독 토큰일 때만 셉니다.
- 습관어(`이제/약간/그러니까/뭐랄까/뭐/막/좀/진짜/그냥/일단/사실(은)/아무튼/어쨌든/솔직히`)도 셉니다.
- `그/저`는 망설임 신호가 있을 때만 셉니다: 바로 뒤에 쉼표·말줄임표가 오거나, 같은 음절로 다시 시작하거나("저 저희는"), 뒤에 간투사가 올 때입니다. 그래서 "그 제품", "저희는"은 세지 않습니다.

## 수정 라운드 1 검증 (2026-11-12 23:00–23:20 KST, 리뷰 지적 9건)

| 지적 | 수정 | 확인 방법과 결과 |
|---|---|---|
| (blocker) 모든 공급자 쿼터 소진 | Gemini 폴백 체인 추가, `/api/report/health`, 요청별 `provider` | `question:qs_mwdlwe06tr6dc` 실생성 1차: 8개 섹션 중 5개 성공, 3개는 Gemini 일일/분당 한도로 실패 → 저장 없이 오류(130초). 2차(재시도): 5개 재사용 + 3개와 종합 새로 실행 → **70점 완성 리포트**(124초, 9회 호출, 3.6-flash×4·3.5-flash-lite×2·3.1-flash-lite×2·3.5-flash×1). `report/samples/report-question-gemini.json`. 대응력 Q4 13점(회피, 340억↔210억 모순, 덱 p.5 / 제안서 p.4·17 재근거화) |
| (major) 실패해도 캐시·100점 | 실패 섹션이 있으면 `ReportIncompleteError`, 저장·점수 없음 | provider=claude 강제 실패: 0.56초 만에 `error`, `retryable:false`, 한국어 문구. 리뷰가 남긴 손상 캐시 `d710f6179ed563bf`(100점), `327e8a0ed43095e0`(0점)는 `.data/report/invalid/`로 격리, 읽기 시에도 `isCompleteReport`가 거부 |
| (major) 다시 생성이 정상 리포트 덮어씀 | 완성본만 원자적 저장 | `fixture:sample` force + provider=claude: `d1a14766f022eef8.json` sha1 `b19626ac…` 전후 동일, 목록 70점 유지. 브라우저에서도 같은 결과(아래 fix-ui) |
| (minor) 쿼터 오류 재시도로 77–102초 | 최종 오류 분류, SDK 재시도 0, down 표시 | Claude 전부 실패 0.56초, OpenAI 전부 실패 1.8초(이전 77–102초) |
| (minor) 영문 오류·결제 URL 노출 | `koError`, 진행 행에는 짧은 문구 | 화면: "AI 채점 실패 · Claude 사용 한도 초과". 원문은 서버 로그만 |
| (minor) Q&A만 있을 때 발표로 채점 | `computeSpeechMetrics` 폴백 제거 | 단위 테스트 추가(8/8), `review-metrics.mjs` qa-only → n=0, 군말 0 |
| (minor) 근거 칩 중복 | `dedupeRefs`(생성 시 + 기존 캐시 읽기 시) | 새 리포트 참조 57쪽 중 중복 0. 기존 `d1a14766…` 서빙 응답도 중복 12→0 |
| (minor) Claude 경로 미검증 | 환경 문제, 해결 불가 | 2026-12-01 이후 `provider:"claude"`로 재검증 필요 |
| (minor) 같은 id 붙여넣기 덮어쓰기 | 내용이 다르면 `<id>-<hash6>`로 따로 저장, 같으면 기존 선택 | curl: `saved:fix-dup-test` → 같은 내용 `duplicate:true` → 다른 내용 `saved:fix-dup-test-e9cdd4, renamed:true`. UI에 안내 문구 |

```bash
node --test report/tests/metrics.test.mjs                 # 8/8
node report/tests/fix-ui.mjs                              # 헤드리스 Chrome 15/15 PASS (실패 다시 생성, Gemini 리포트, 붙여넣기 안내)
node --env-file=.env.local report/tests/probe-providers.mjs   # 공급자별 1회 핑 (키 출력 없음)
curl -sN -X POST localhost:3100/api/report/generate -H 'content-type: application/json' -d '{"ref":"fixture:sample","force":true,"provider":"claude"}'   # 실패 경로
```

- 스크린샷(`pocs/.verify/report/fix/`): `m-fail-regenerate.png`, `d-fail-regenerate.png`(섹션별 짧은 오류 + 오류 카드, 점수 없음), `m-gemini-result.png`, `d-gemini-result.png`(새 리포트 70점, 판정 모델 표기), `m-paste-note.png`
- NDJSON 원본: `.verify/report/fix/force-fail.ndjson`, `force-fail-openai.ndjson`, `gen-question.ndjson`(1차 부분 실패), `gen-question-retry.ndjson`(2차 완성)
- 판별 실험(BAD 37 < GOOD 77)은 gpt-5.5로 만든 캐시를 유지했습니다. Gemini 무료 한도를 아끼려고 다시 돌리지 않았습니다.

## 검증 결과 (2026-11-12, 실호출, OpenAI 폴백 경로)

### 판별 실험: `report/samples/discrimination.json`

세션은 `node report/scripts/make-sessions.mjs`로 결정적으로 만들었습니다.

- **BAD:** 군말 57회, 503음절/분, 시간 31% 사용, 침묵 3회. 수치 11개를 틀리게 말함(SOM 500억, 원가 98원, 재구매율 95%, 고객 30곳, 투자 30억 등). 답변은 회피성.
- **GOOD:** 수치를 제안서 기준으로 정정하고, 답변은 근거와 계산을 갖춤.

| 세션 | 총점 | 발표력 | 논리성 | 대응력 | 자료 | 질문별 점수 | 전달 지표 |
|---|---|---|---|---|---|---|---|
| BAD | **37** | 30 | 40 | 24 | 59 | 22 / 14 / 34 / 24 (모두 evasive) | 503 spm · 군말 36.3/분 · 전달 24 |
| 픽스처 샘플 | **70** | 88 | 69 | 62 | 59 | 77 / **35 evasive**(118↔142원 회피) / 73 / 62 weak(생산능력 미검증) | 318 spm · 군말 1.3/분 · 전달 100 |
| GOOD | **77** | 88 | 69 | 87 | 58 | 81 / 96 / 82 / 89 | 301 spm · 군말 0 · 전달 100 |

- **판별력:** BAD와 GOOD의 차이는 40점입니다. 같은 세션을 두 번 생성했을 때 BAD는 38→37, GOOD은 76→77로 ±1점 안에서 재현됐습니다. 순서도 픽스처의 의도와 맞습니다(BAD < 샘플 < GOOD).
- **자료 점수는 세 세션이 같습니다.** 같은 PDF이므로 의도한 결과입니다. 덱은 55–58점, 제안서는 58–64점입니다.
- **모순과 쪽 번호:** BAD의 발표 중 수치 오류 11건이 모두 맞는 쪽으로 재근거화됐습니다(`grounded:true`). 예시:
  - 원가 98원 ↔ 덱 p.6 118원 / 제안서 p.34 142원
  - 재구매율 95% ↔ 덱 p.8 83%
  - SOM 500억 ↔ 덱 p.5 340억 / 제안서 p.4·7·17 210억
  - 투자 30억 ↔ 덱 p.12 20억
  - 픽스처 샘플 Q2의 모순 인용은 덱 p.6·p.9와 제안서 p.9·p.34로, 픽스처의 의도된 약점 #1과 일치합니다.
- **수치 대조표:** 세 실행 모두 불일치 4건을 찾았습니다. 원가 118↔142원(덱 p.6 / 제안서 p.3·5·9·20), 이익률 28%↔약 14%, SOM 340억↔210억, 점유율 5%↔3.1%입니다.
- **자료 이슈:** 생산능력 대비 매출 산식 부재(약점 #3)와 원료 단일 공급처(약점 #4)를 high/medium으로 지적했습니다.
- **심사 질문 PoC 세션과의 연동:** `question:qs_mwdlvy0ltsmet`(docId 포함, wiki 문서를 그대로 사용)으로 리포트를 만들었습니다. 63.4초, 총점 68점이었습니다.

### 지연·비용 (질문 4개 세션)

- **전체 46–66초.**
  - 지표 계산은 1ms 미만, 위키 준비는 0초(재사용)입니다.
  - lint는 첫 회 16초, 이후 0초입니다.
  - 병렬 구간 중 가장 느린 호출은 덱 품질이나 발표 분석으로 40–54초입니다. 종합은 11–15초입니다.
- **사용량:** LLM 호출 9회, 입력 약 87k, 출력 약 20k 토큰입니다.
- **캐시:** 같은 세션을 다시 요청하면 19ms(`cached`) 안에 끝납니다.

### 테스트 명령 (pocs/에서)

```bash
node --test report/tests/metrics.test.mjs                  # 단위 테스트 8/8 (수정 라운드에서 qa-only 케이스 추가) (음절, 군말, 그/저 판별, 속도·침묵, phase, 픽스처 3종)
node report/scripts/make-sessions.mjs                      # BAD/GOOD 세션 재생성 (결정적)
node report/tests/run-report.mjs fixture:sample sample --force       # 실호출 → report/samples/report-sample.json
node report/tests/run-report.mjs sample:session-bad bad --force
node report/tests/run-report.mjs sample:session-good good --force
node report/tests/ui.mjs --live                            # 헤드리스 Chrome 28/28 PASS
pnpm exec tsc --noEmit | grep -E '^(report/|app/report/|app/api/report/)'   # 0건
pnpm exec eslint report app/report app/api/report          # 0건
```

- **UI 테스트(28/28) 확인 항목**
  - 모바일 390×844와 데스크톱 1280
  - 세션 목록
  - BAD, GOOD, 샘플의 결과 화면
  - JSON 다운로드(`Content-Disposition: attachment`)
  - 질문 카드: 점수 배지, "이렇게 답해 보세요", Q2 모순 칩(덱 p.6·p.9, 제안서 p.9·p.34)
  - 발표 분석 탭: 지표와 슬라이드 12장 커버리지
  - 자료 품질 탭: 불일치 4건
  - 가로 넘침 0(요소 단위 검사), 콘솔 오류 0
  - 붙여넣기 세션 → 실시간 생성(진행 표시 확인, 52초에 완료)
- **API 엣지 케이스(curl):**
  - 잘못된 JSON → 400
  - 없는 ref → 404
  - 스키마 위반 세션 → 400(zod 상세 포함)
  - `saved:..%2F..` 경로 조작 → 404
  - 없는 report key → 404
  - `.next/static`에서 API 키 문자열 검색 → 0건

### 스크린샷 (`pocs/.verify/report/`)

- 모바일:
  - `mobile-1-pick.png`
  - `mobile-2-result-{sample,bad,good}.png`
  - `mobile-3-qa1.png`, `mobile-4-qa2.png`
  - `mobile-5-speech.png`, `mobile-6-materials.png`
  - `mobile-7-progress.png`, `mobile-8-live-result.png`
- 데스크톱:
  - `desktop-1-pick.png`, `desktop-2-result-sample.png`
  - `desktop-3-qa1.png`, `desktop-4-qa2.png`
  - `desktop-5-speech.png`, `desktop-6-materials.png`

## 라우트 / API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/report` | UI (`?session=&view=&tab=`) |
| GET | `/api/report/sessions` | `SessionSummary[]`. 출처: `fixture:sample`, `question:<f>`(.data/question/sessions, 동적 목록), `saved:<f>`(붙여넣기), `sample:<f>`(report/samples). 캐시된 리포트가 있으면 점수를 함께 줍니다 |
| POST | `/api/report/sessions` | 본문 = SessionRecord → zod로 검증 후 `.data/report/sessions/`에 저장 → `{ref, renamed, duplicate}`. 같은 id인데 내용이 다르면 덮어쓰지 않고 `<id>-<hash6>`로 저장 |
| GET | `/api/report/sessions/{ref}` | SessionRecord |
| POST | `/api/report/generate` | `{ ref? \| session?, force?, provider? }` → `application/x-ndjson` 스트림: `steps` → `step`… → `done{report}`. 캐시가 있으면 `cached`를 보낸 뒤 `done`. 섹션 하나라도 실패하면 `error{error, failedSteps, retryable}`(저장 없음) |
| GET | `/api/report/health` | 판정 모델별 down 여부와 사유(호출 없음) |
| GET | `/api/report/reports/{key}[?download=1]` | 캐시된 Report JSON. `download`를 붙이면 첨부 파일로 받습니다 |

## 라이브러리 (실제 앱에서 재사용)

```ts
import { generateReport, computeSpeechMetrics, listSessions, getSession, readCachedReport, reportKey } from "@/report/lib"; // server-only
import type { Report, SpeechMetrics, QAEvaluation, DocEvaluation, ProgressEvent } from "@/report/lib/types";        // client OK
import { computeSpeechMetrics } from "@/report/lib/metrics"; // 순수 함수. 브라우저에서 실시간 지표용으로도 쓸 수 있음

const report = await generateReport(session, { force?: boolean, provider?: "claude" | "openai" | "gemini", onProgress?: (e: ProgressEvent) => void });
// 실패 시 ReportIncompleteError { message(한국어), failedSteps, retryable } — 아무것도 저장하지 않음
// isCompleteReport(report), llmHealth(), LlmUnavailableError 도 export
const m = computeSpeechMetrics(session.transcript, { presentationMinutes: 5 /*, phase: "presentation" | "qa" | "all" */ });
```

- `Report = { meta, speech: { metrics, analysis }, qa: QAEvaluation[], materials: { docs, consistency, score }, overall: { total, sub, weights, headline, oneLiner, strengths, priorities } }` (`report/lib/types.ts`)
- 파일 구성:
  - `lib/metrics.ts`: 결정적 지표
  - `lib/context.ts`: wiki 컨텍스트, lint 캐시, 쪽 재근거화
  - `lib/prompts.ts`: 루브릭과 zod 스키마
  - `lib/llm.ts`: Claude → OpenAI → Gemini 폴백 체인, 오류 분류·재시도 정책, 한국어 오류 문구
  - `lib/generate.ts`: 병렬 오케스트레이션, 점수 집계, 캐시
  - `lib/sessions.ts`: 세션 출처 관리
  - `components/`: `ReportStudio`(상태·흐름), `ReportViews`(결과·상세 3탭), `parts`(작은 UI 요소)

## HIL 체크리스트 (사람이 해 볼 것)

1. http://localhost:3100/report 를 휴대폰 폭과 데스크톱에서 엽니다. 세션 목록에 픽스처, 심사 질문 PoC 세션, BAD/GOOD 테스트 세션이 보이는지 확인합니다.
2. **리포트 테스트 · report-test-bad**와 **good**의 저장된 리포트를 엽니다. 37점 대 77점, 영역별 점수, "잘한 점 / 다음 연습에서는"이 납득되는지 판단합니다. 특히 BAD에서 억지 칭찬이 나오지 않는지 봅니다.
3. 픽스처 샘플에서 "상세 피드백 보기"를 누릅니다. **질문 2(118원 vs 142원)** 가 회피(35점)로 나오는지 확인합니다. 모순 칩(발표자료 p.6, 제안자료 p.34)을 눌러 PDF 해당 쪽이 열리고 값이 실제로 그 쪽에 있는지 봅니다.
4. 질문별 "이렇게 답해 보세요"를 소리 내어 읽어 봅니다. 30초 안에 말할 수 있는지, 자료에 없는 사실을 지어내지 않았는지 확인합니다. 질문 1은 "리뷰 불만 40% 감소"를 자료로 확인할 수 없다고 정직하게 처리해야 합니다.
5. **발표 분석** 탭에서 확인할 것:
   - 말 속도(318음절/분), 군말(음×2, 그러니까×2…)과 예문의 하이라이트가 실제 전사와 맞는지
   - BAD에서 503음절/분, 군말 36회/분, 침묵 3회가 잡히는지
   - 슬라이드 커버리지(12장)의 "일부/누락" 판단이 타당한지
6. **자료 품질** 탭에서 덱↔제안서 대조표의 불일치 4건(원가, 이익률, SOM, 점유율)과 쪽 번호, 이슈별 "고치는 법"이 실행 가능한지 확인합니다.
7. "다시 생성"을 눌러 섹션별 진행 표시(준비, 1–4)가 실시간으로 바뀌는지, 약 1–2분 안에 끝나는지, 점수가 ±3점 안에서 재현되는지 봅니다. **공급자 한도 때문에 실패하면** 점수 없이 한국어 오류 카드만 나오고, "세션 목록"으로 돌아가면 기존 점수 배지와 저장된 리포트가 그대로 있어야 합니다. "다시 시도"를 누르면 이미 끝난 섹션은 "이전 시도 결과 재사용"으로 표시됩니다. 지금 어떤 모델을 쓸 수 있는지는 http://localhost:3100/api/report/health 에서 봅니다.
8. "SessionRecord JSON 붙여넣기"에 sample-session.json을 고쳐서 넣습니다. 예: 답변을 "모르겠습니다"로 바꾸거나, 전사에 "음, 어"를 추가합니다. 그 변화가 점수와 피드백에 반영되는지 확인합니다. 잘못된 JSON을 넣으면 오류 문구가 나오는지도 봅니다. id를 바꾸지 않고 내용만 고쳐 넣으면 "덮어쓰지 않고 '<id>-xxxxxx'로 따로 저장했어요"가 나오고 목록에 두 세션이 모두 있어야 합니다.
9. "JSON 다운로드"로 받은 파일이 실제 앱에서 저장·재사용하기에 충분한 구조인지 검토합니다.
10. 점수 가중치(발표력 25, 논리성 25, 대응력 30, 자료 20)와 전달 지표 기준(적정 240–340음절/분, 군말 분당 2회)이 제품 의도와 맞는지 결정합니다.

## 알려진 한계

- **Claude 경로는 실호출로 검증하지 못했습니다**(키 한도, 2026-12-01 복구). 저장된 리포트는 `gpt-5.5`(5건) 또는 Gemini(1건) 판정입니다. 복구 뒤 `provider:"claude"`로 판별 실험을 다시 돌려야 합니다.
- **지금 새 리포트 생성은 Gemini 무료 등급에 기대고 있습니다.** 모델별 하루 20회라서 리포트 1건(질문 4개 기준 9회 + 재시도)마다 한도가 빠르게 줄고, 분당 한도와 503(수요 과다)도 자주 납니다. 두 번째 시도에서야 완성되는 경우가 있습니다. lite 모델 판정은 opus/gpt-5.5보다 품질이 낮을 수 있고(예: "모순 1"이 있는데 93점), 한 리포트 안에서 섹션마다 다른 모델이 판정할 수 있습니다. 어떤 모델이 썼는지는 화면 하단과 `meta.usage.byModel`에 나옵니다. 키를 충전하면 코드 수정 없이 Claude/OpenAI로 돌아갑니다(down 표시는 30분 뒤 자동 해제).
- 섹션 재사용 메모리는 서버 프로세스 안에만 있습니다(2시간). 서버를 재시작하면 처음부터 다시 생성합니다.
- STT 문장 단위 타임스탬프에는 시작 시각만 있어서, 문장 길이와 침묵은 조음 속도 추정에 기반한 근사치입니다. 단어 단위 타임스탬프가 있으면 정확해집니다.
- 군말 사전은 규칙 기반입니다. "좀", "사실", "이제"처럼 의미가 있는 쓰임도 셀 수 있습니다(습관어로 따로 표시). 억양과 목소리 크기는 분석하지 않습니다.
- 자료 평가는 텍스트만 봅니다. 시각 디자인과 차트 가독성은 평가하지 않습니다. 제안서는 전문 대신 위키 요약(28k자)을 쓰므로, 위키에 빠진 세부 내용은 평가에서 놓칠 수 있습니다.
- LLM 판정은 실행마다 조금씩 달라집니다. 같은 세션의 총점은 ±1–3점, 개별 질문 점수는 ±5점 정도 변했습니다. 수치 대조표의 지표 묶음 방식도 실행마다 다를 수 있습니다.
- 발표 중 덱 수치를 그대로 읽은 것(덱과 제안서가 서로 다른 경우)도 medium 수치 이슈로 표시합니다. 자료 쪽 문제인지 발표 쪽 문제인지에 대한 제품 정책이 필요합니다.
- 심사위원 얼굴은 세션의 `judges[].imageUrl`이 있을 때만 보입니다. 없으면 이니셜을 표시합니다.

## 다음 단계

- 실제 앱: 질의응답이 끝나면 `generateReport`를 백그라운드로 시작하고, 결과 화면은 NDJSON 진행 상황을 구독합니다.
- 발표 분석(speech)은 질의응답 중에 미리 시작할 수 있습니다. 전사가 확정되는 즉시 돌리면 체감 대기를 약 50% 줄일 수 있습니다.
- Claude 복구 뒤:
  - opus와 gpt-5.5의 판정 일관성을 비교합니다(같은 세션 5회 표준편차).
  - 제안서 위키 요약 prefix에 프롬프트 캐싱을 적용합니다(QA N개와 문서 평가가 같은 prefix를 씁니다).
- 회차 간 비교: 세션 기록(07-history)에 영역별 점수 추이와 "지난번 개선점이 고쳐졌는지"를 표시합니다.
- 단어 단위 STT 타임스탬프(gemini transcribe)를 연동해 침묵과 속도 계산을 정밀하게 합니다. QA 답변 지연(질문 후 첫 발화까지)도 지표로 추가합니다.
