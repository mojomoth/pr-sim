# wiki — Context to Wiki (Karpathy LLM Wiki)

사용자가 올린 PDF(발표자료/제안자료) **한 개를 위키 한 개**로 바꿉니다. 프로젝트 문서 위키가 아니라, 업로드한 파일 자체가 위키입니다. 질문·리포트 에이전트는 PDF 전문을 프롬프트에 넣지 않고 `queryWiki()`로 필요한 페이지만 받아 씁니다. 받는 양은 문자 수 예산으로 정하고, 모든 문장에 `(p.N)` 출처가 붙습니다.

- UI: **http://localhost:3100/wiki** (`?doc=<docId>&tab=wiki|query|lint|log&page=<slug>`)
- 원리: [Andrej Karpathy, LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

## Karpathy LLM Wiki를 여기서 구현한 방법

| gist의 개념 | 이 PoC에서 구현한 내용 |
|---|---|
| **Raw sources (불변)** | `.data/wiki/<docId>/raw/`: `source.pdf`, `pages/NNN.txt`(unpdf로 쪽별 텍스트 추출), `meta.json`. 한 번 쓴 뒤로는 수정하지 않습니다. 출처 `(p.N)`는 모두 이 원문을 가리킵니다 |
| **The wiki (LLM이 관리)** | `.data/wiki/<docId>/wiki/*.md`: `overview`, `주요-수치`, 주제 페이지(`시장-규모`, `원가-구조`, `경쟁사`, `비즈니스-모델`, `재무-계획`, `팀`, `리스크` …), 엔티티 페이지(`웨이브셀` 등), 질의 결과를 저장한 `analysis` 페이지. 페이지끼리 `[[wikilink]]`로 연결되고, frontmatter에 `title/type/summary/sources/updated`가 있습니다 |
| **The schema** | 문서마다 `wiki/SCHEMA.md`를 둡니다. 페이지 형식, 출처 표기, 링크 규칙, `[불일치]`/`[검토]` 표기, 작업 절차를 적은 규칙 문서입니다. 같은 규칙이 프롬프트(`lib/prompts.ts`)에도 들어갑니다 |
| **index.md** | 모든 페이지의 카탈로그입니다. 분류별로 한 줄 요약과 출처 범위를 적습니다. 병합 라운드가 끝날 때마다 페이지 frontmatter(LLM이 쓴 요약)를 모아 결정적으로 다시 만듭니다. QUERY는 이 파일부터 읽습니다 |
| **log.md** | 추가만 하는 작업 기록입니다. 형식은 `## [YYYY-MM-DD HH:mm:ss] <op> \| …`이고 op는 ingest/plan/merge/finalize/query/file/lint입니다. `grep "^## \["`으로 파싱할 수 있습니다. query는 **답변이 생성된 질의(같은 질문은 프로세스당 1번)와 저장된 질의만** 남깁니다. 캐시 적중이 아닌 모든 질의 호출은 `log-queries.md`(같은 형식, 콘텐츠 페이지 목록에는 안 나옴)에 남습니다 |
| **INGEST** | 원문을 읽고 → 관련 페이지 10~20개를 만들거나 고치고 → index와 log를 갱신합니다. 큰 PDF를 처리하는 방식은 아래 파이프라인에서 설명합니다 |
| **QUERY** | index를 읽고 → 관련 페이지를 고르고 → 링크를 한 단계 따라간 뒤 → 예산 안에서 출처가 붙은 컨텍스트를 만들고 → 필요하면 답변합니다. 좋은 답변은 `save`로 `analysis` 페이지에 다시 넣을 수 있습니다(지식이 쌓이는 구조) |
| **LINT** | 결정적 검사(깨진 링크, 고아 페이지, 출처 없는 수치, 범위 밖 쪽 번호)와 LLM 검사(모순, 자료 공백, 누락 페이지, 오래된 주장)를 함께 돌립니다. `against`를 주면 **문서 간 수치 불일치**도 검사합니다 |

## INGEST 파이프라인 (큰 PDF 대응)

```
PDF ─unpdf→ raw/pages/NNN.txt (불변)
  │ 청크: 6~8쪽, 최대 14,000자 (12쪽 덱 → 2개, 58쪽 → 8개, 128쪽 → 18개)
  ▼
① EXTRACT  청크별 병렬(동시 8) ── gpt-5.4-mini
           → {summary, topics[{slug,title,type,facts[{claim,pages}]}], numbers[{metric,value,pages,context}]}
           (청크 범위 밖 쪽 번호는 그 사실의 수치가 실제로 적힌 청크 안 쪽으로 바꾸고 — 예전에는 청크 첫 쪽으로
            고정해 오인용이 생김 — 예약 slug는 피함)
② PLAN     후보 slug 전체 → 최종 페이지 구조(동의어 병합, 상한 ≈10+쪽수/6, 최대 30) ── 1회 호출
③ MERGE    라운드(청크 3개씩, 최대 5라운드)를 문서 순서대로 직렬 처리.
           라운드 안에서는 바뀌는 페이지마다 작성자 1명을 두고 병렬 처리(동시 10).
           작성자는 index.md + 기존 페이지 본문 + 새 사실을 보고 {create|update|append|skip} 중 하나를 반환
           → 데이터 손실 방지: update가 기존 인용 쪽의 30% 넘게 잃으면 append로 바꿈
           → 실패하면 사실 목록 섹션을 결정적으로 append
           → index용 summary가 "…를 추가", "기존 내용과 동일" 같은 **편집 메모**면 이전 요약(없으면 본문 첫 "> " 줄)을 유지
           → 라운드마다 index.md를 다시 만들고 log.md에 기록
④ FINALIZE overview(gpt-5.5) ∥ 주요-수치(gpt-5.4-mini, 정규화와 문서 내 충돌 플래그) 병렬
           → 원문 대조(결정적, LLM 0회, lib/numbers-verify.ts): 행마다 값의 수치("210억")가
             인용 쪽 raw에 실제로 있는지 확인. 없으면 그 인용을 빼고(unverified[]),
             그 쪽에 같은 항목이 다른 값으로 적혀 있으면 conflict=true + 비고 "[원문 대조] p.63에는 340억"
           → keynumbers.json(기계 판독용) + 주요-수치.md(표)
           → 본문 수치 인용 재근거화(결정적, lib/reground.ts): 모든 주제 페이지의 (p.N) 묶음마다 앞 문장의
             수치("148원", "25만")가 인용 쪽 raw에 없고 다른 쪽에 있으면, 원 인용에 가장 가까운 그 쪽을 추가
             (원래 쪽은 수치 외 내용을 뒷받침할 수 있어 유지). 원문 어디에도 없는 계산값은 건드리지 않음
           → index 재생성
```

기존 위키에는 `POST /api/wiki/docs/{id}/repair`(= `repairWiki`)로 같은 결정적 정비(인용 재근거화 + 편집 메모 요약 복원 + 주요-수치 대조 + index 재생성)를 LLM 없이 적용합니다. 멱등이라 두 번째 실행은 0건입니다.

- **멱등성:** `docId`는 PDF 내용 SHA-256의 앞 16자리입니다. 같은 파일을 다시 올리면 즉시 `{reused:true}`를 돌려줍니다(측정 16ms). 이미 진행 중인 작업이 있으면 그 작업에 합류합니다. `force`/`reingest`를 쓰면 저장된 원본으로 처음부터 다시 만듭니다.
- **다시 만들기(reingest)는 지금 위키를 지우지 않습니다:** ready 위키를 다시 만들 때는 `wiki.next/`·`state.next/`(스테이징)에 짓고, **성공했을 때만** `wiki → wiki.prev`, `wiki.next → wiki`(state도 같은 방식)로 rename 교체한 뒤 `.prev`를 지웁니다. 그동안 `status.json`은 `state:"ready"`를 유지하고 새 빌드의 진행은 `status.rebuild`(WikiStatus)에 들어가므로 열람·질의·점검·question/report PoC가 계속 이전 위키를 씁니다. 실패하면 스테이징을 지우고 이전 위키(페이지·keynumbers·lint·notes·plan)를 그대로 두며 `status.lastReingestError`/`lastReingestAt`을 남깁니다(UI 진행 카드에 "마지막 다시 만들기 실패" 표시, log.md에도 기록). 성공하면 이전 log.md 기록 뒤에 새 빌드 기록을 이어 붙이고 `log-queries.md`도 옮기며, 이전 위키 기준의 lint 보고서와 저장된 analysis 페이지는 새 위키와 함께 사라집니다. 스테이징 중에는 `saveAnswer`·`repair`·`verify-numbers`·삭제가 409로 거절됩니다(교체 때 버려질 쓰기라서). 구현은 `store.ts`의 `runStaged()`(AsyncLocalStorage로 그 작업 안에서만 wikiDir/stateDir을 스테이징으로 돌림). 시작 전에 **프리플라이트**(`probeLlm()`: 차단기가 열려 있으면 즉시, 아니면 가장 작은 모델로 1회 호출)로 쓸 수 있는 제공자가 없으면 아무것도 시작하지 않고 503 + 한국어 사유를 돌려줍니다. 처음 인제스트와 error 상태 문서의 "다시 시도"는 예전처럼 제자리에서 만듭니다.
- **진행 상황:** `state/status.json`의 단계, 청크 n/m, 라운드 n/m, 생성·갱신 수, 모델별 호출·토큰, 이벤트를 UI가 SSE(`/events`)로 받아 보여 줍니다.
- 작업 레지스트리는 `globalThis`에 있어 HMR에도 유지됩니다. 서버가 재시작되면 진행 중이던 작업은 `error: 중단됨`으로 표시되고, 같은 PDF를 다시 올리면 새로 만듭니다.

## 모델 선택과 이유

**Claude 키가 2026-12-01까지 사용 한도에 걸려 있습니다**(400 "usage limits", fixtures 에이전트가 처음 보고). 그래서 LLM 계층을 provider 추상화(`lib/llm.ts`)로 만들었습니다.

- `WIKI_LLM_PROVIDER`의 기본값은 `auto`입니다. Claude를 먼저 시도하고, 한도·인증·연결 오류가 나면 OpenAI로 넘어갑니다.
- **회로 차단기(fix-r2):** 제공자가 크레딧 소진·사용 한도·인증 오류를 내면 프로세스 전역 차단기가 60초 동안 열려 그 제공자를 즉시 건너뜁니다(연결 오류는 30초). 두 제공자가 모두 막히면 네트워크 호출 없이 바로 `LlmUnavailableError`("AI 제공자를 쓸 수 없습니다 (Claude 사용 한도 초과, OpenAI 크레딧 소진). 크레딧을 충전하거나…")를 던집니다. 60초가 지나면 다시 한 번 시도하므로 크레딧을 충전하면 1분 안에 서버 재시작 없이 복구됩니다.
- OpenAI SDK는 429를 모두 재시도합니다(`maxRetries 4`). 회복되지 않는 `insufficient_quota` 429에는 커스텀 fetch가 `x-should-retry: false`를 붙여 재시도를 끕니다. `withRetry`도 쿼터·인증·4xx·abort/timeout은 재시도하지 않고 스키마·JSON·5xx·rate limit만 재시도합니다.
- 따라서 12/1 이후에는 코드를 바꾸지 않아도 Claude 경로로 돌아갑니다. 단, Claude 경로는 아직 **실호출로 검증하지 못했습니다**.
- `openai`나 `claude`로 고정할 수도 있습니다.

| 단계(tier) | OpenAI (검증됨) | Claude (키 복구 후) | 이유 |
|---|---|---|---|
| extract / write / numbers / plan / lint | `gpt-5.4-mini`, reasoning low | haiku-5-5(extract), sonnet-5-5 | 대량 읽기·쓰기 단계입니다. 8쪽 청크 추출 실측: mini 14.5초 / nano 17.9초(사실 수가 적음) / gpt-5.5 39초. mini가 품질과 지연의 균형이 가장 좋습니다 |
| overview | `gpt-5.5`, low | opus-5-5 | 한 번만 부르는 종합 단계라 품질을 우선했습니다. 주요-수치와 병렬로 돌기 때문에 전체 시간에는 거의 영향이 없습니다(약 22초) |
| select (QUERY) | `gpt-5.4-nano`, reasoning none | haiku-5-5 | 핫패스입니다. index(약 3~4천 자)만 보고 slug를 고르며 1.4~3초 걸립니다 |
| answer (QUERY) | `gpt-5.4-mini`, reasoning **low** | haiku-5-5 | 약 3~4.5초. 처음에는 reasoning none(2~3초)이었으나 단위 계산을 10배 틀렸습니다(25만×12×165원을 "49.5억"으로 계산). 그 결과 "가능하다"는 잘못된 판단을 내려 low로 올렸습니다. 다른 에이전트는 보통 `context`만 쓰므로 답변 지연은 핫패스가 아닙니다 |

- 구조화 출력은 zod 스키마를 `z.toJSONSchema`로 바꿔 씁니다. OpenAI는 `text.format json_schema strict`, Claude는 `output_config.format`(스트리밍 + `finalMessage`)입니다.
- 재시도: SDK `maxRetries 4`(쿼터 429 제외)에 스키마·JSON 오류 재시도(`withRetry`, 재시도 가능한 오류만)를 더했습니다.
- 데드라인: QUERY select 5초(`selectTimeoutMs`, 넘으면 어휘 매칭), answer 60초(`answerTimeoutMs`), LINT 120초.

## 측정 결과 (2026-11-12, OpenAI 경로, 실호출)

### INGEST

| 문서 | 쪽 / 문자 | 청크 / 라운드 | 시간 | LLM 호출 | 토큰(입력/출력) | 위키 페이지 | 주요 수치 |
|---|---|---|---|---|---|---|---|
| `fixtures/presentation.pdf` | 12 / 2,682 | 2 / 1 | **48.1초** | 19 | 25k / 15k | 16 | 50행, 충돌 0 |
| `fixtures/proposal.pdf` | 58 / 100,789 | 8 / 3 | **125.4초** (추출 38초, 계획 11초, 병합 54초, 마무리 22초) | 56 | 213k / 102k | 20 | 68행, 충돌 1건(누적 출고 158만 vs 157.6만, 실제로 원문에 있는 표기 차이) |
| `wiki/fixtures/large-128p.pdf` (제안서+덱+제안서를 pdfunite로 합침) | 128 / 204,260 | 18 / 5 | **240.5초** (추출 82초, 병합 124초) | 100 | 482k / 234k | 20 | 61행, 충돌 6건. 이 중 **118원↔142원, 28%↔14%** 는 덱(합본 p.64)과 제안서의 불일치를 자동으로 찾은 것 |

- 쪽수에 대해 대략 선형으로 늘어납니다. 병합 라운드는 최대 5개로 묶어 직렬 구간에 상한을 두었습니다.
- 비용은 위 토큰 수에 현재 단가를 곱해 계산하세요. 58쪽 문서 기준으로 mini 입력이 약 21만 토큰, 출력이 약 10만 토큰입니다.

### QUERY: `node wiki/tests/queries.mjs <proposal> <presentation> <large>` → `.verify/wiki/queries-llm.json`, `queries-lexical.json`

- 대상은 10개 질문입니다(제안서 7, 발표자료 2, 128쪽 합본 1). 의도된 약점 수치를 포함합니다: 원가 142/118원, 이익률 14/28%, SOM 210/340억, 2027년 32억과 월 25만 세트, 원료 수협과 리스크 "낮음", 20억, 83%, 165원.
- **정답 검증:** 기대 수치가 답변에 있어야 하고, 동시에 답변이 인용한 쪽의 **raw 원문에도 실제로 있어야** 통과로 셉니다.
- **결과:** LLM 선택기 **10/10 통과**, 수치-인용 정밀도 **29/29 → 32/33**(실행마다 다름). 답변 문장 속 숫자가 그 문장이 인용한 쪽 원문에 있는지 본 값입니다. 놓친 1건은 "142원과 다르다(p.64)"처럼 비교 대상의 쪽만 인용한 경우입니다.
- 2026-11-12 리뷰 수정 뒤 다시 실행: **10/10**, 정밀도 **34/34**. 답변 reasoning을 low로 올린 뒤 전체 지연은 4.1~5.1초입니다.
- **어휘 선택기**(`selector:"lexical"`, LLM 호출 없음, 0~1ms)도 **10/10**, 정밀도 37/37이었습니다. 전체 지연은 LLM 선택 4.0~5.4초, 어휘 선택 1.9~3.0초였습니다.
- **컨텍스트 크기:** 6,000자 예산으로 제안서 전문 100,789자의 **4.6~6.0%**, 128쪽 합본 204,260자의 **2.9%** 만 씁니다(≈3.6k 토큰 vs 전문 ≈60k/120k 토큰).
- **작은 문서:** 12쪽 덱처럼 원문 전체가 예산의 절반 안에 들어가면 `mode:"raw+wiki"`로 원문 전체에 위키 페이지를 덧붙입니다. 손실이 없고 더 정확합니다.

### LINT: `node wiki/tests/lint.mjs <doc> [against]` → `.verify/wiki/lint-*.txt`

- **제안서 vs 발표자료:** high 등급 `cross-doc-mismatch` 3건을 모두 찾았습니다.
  - SOM 210억(3.1%) vs 340억(5%)
  - 원가 142원 vs 118원
  - 이익률 약 14% vs 28%
  - 인용 쪽은 메시지에 나온 수치로 raw 원문을 다시 검색해 정했습니다. 그 결과 덱 p.5/p.6/p.9, 제안서 p.3·5·22·34 등 **정확한 쪽**을 가리킵니다. 처음 구현에서는 LLM이 쪽 번호를 잘못 붙였고, 이 재근거화 단계를 넣어 고쳤습니다.
- **제안서 단독:** 의도된 약점 #3과 #4를 찾았습니다.
  - 성장 가정의 근거 부족(32억·96억·210억 vs LOI 3건·월 8곳, 전환율·CAC 없음)
  - 생산능력 계산 부족
  - 수협 1곳 단일 공급처 의존
  - 그 밖에 오래된 주장과 고아 페이지 같은 결정적 이슈도 나옵니다.
- 10~11건 처리에 14~20초 걸립니다.

### UI: `node wiki/tests/ui.mjs <docId> [--live]` (헤드리스 Chrome, 390×844 모바일과 1280 데스크톱)

- 결과는 **21/21 PASS**(`--live`, 실제 질의와 문서 간 lint 포함)와 17/17(비 live)입니다.
- 확인 항목:
  - overview 렌더
  - `[[link]]` 이동
  - 주요-수치 표(68행)
  - `(p.N)` 칩 → raw 원문 시트
  - 질의 답변과 인용
  - 문서 간 lint의 118/142원 표시
  - log 렌더
  - 콘솔 오류 0, HTTP 4xx 0
  - 가로 넘침 0(요소 단위 검사)
- `node wiki/tests/progress.mjs <docId>`: UI의 "위키 다시 만들기"로 128쪽 문서를 재인제스트하면서 SSE 진행 표시를 8초/45초/110초에 캡처했습니다. 완료까지 242초, 콘솔 오류 0입니다.
- 스크린샷(`.verify/wiki/`):
  - 모바일: `mobile-1-top.png`, `mobile-3-numbers.png`, `mobile-4-raw-sheet.png`, `mobile-5-query.png`
  - 데스크톱: `desktop-1-top.png`, `desktop-5-query.png`, `desktop-6-lint.png`
  - 진행 표시: `progress-8s.png`, `progress-45s.png`, `progress-110s.png`, `progress-done.png`, `progress-mobile-done.png`
- 처음 모바일 화면에서 grid 트랙이 표의 min-width 때문에 뷰포트보다 넓어지는 버그가 있었습니다. `grid-cols-[minmax(0,1fr)]`로 고쳤고, 검사 방식도 요소 단위로 강화했습니다.

### 리뷰 1차 수정 검증 (fix-r1): `node wiki/tests/fix-r1.mjs` → **19/19 PASS**, `.verify/wiki/fix-r1/`

| 리뷰 지적 | 수정 | 확인 |
|---|---|---|
| (major) 7쪽 넘는 인용이 가짜 범위 칩 `p.3–52`로 보이고 첫 쪽만 열림 | 범위 칩을 없앴습니다. 실제 쪽 4개를 칩으로 보이고 나머지는 `+N쪽`으로 표시합니다. 어느 칩을 눌러도 시트에 **그 인용의 모든 쪽** 목록이 나오고, ‹ ›는 인용된 쪽만 차례로 이동합니다("이 인용의 출처 5/6") | proposal 주요-수치: 범위 칩 51 → **0**. 임직원 수 행에서 시트 목록이 keynumbers의 쪽 `3,8,30,43,46,52`와 같고, ›로 6쪽을 모두 돌며 **6/6 쪽에 "14명"** 이 있음. `d-01-cite-group-sheet.png`, `m-04-cite-group-sheet.png` |
| 판단 질문에 근거 없는 결론("가능하다고 보입니다") | **근본 원인 둘:** (1) 답변 모델이 단위 계산을 틀림 (2) 컨텍스트 패킹이 섹션 단위라 큰 "운영-생산" 섹션과 주요-수치 표(앞 30%만 들어감)에서 "1공장 월 최대 25만 세트"가 빠지기도 함. **수정:** `fitPage`가 이제 **줄(불릿·표 행) 단위**로 질의 관련도를 매겨 담고, 원래 섹션 제목과 표 머리글 아래에 원래 순서대로 다시 묶습니다. 답변 프롬프트도 바꿨습니다. 판단 질문은 계산식을 먼저 보이고 원 단위로 환산합니다. 계산이 목표에 못 미치면 "뒷받침되지 않는다"고 쓰고, 수치가 없으면 판단을 보류합니다. 문서의 주장은 "문서는 ~라고 주장한다"로 씁니다. answer reasoning은 none → low | proposal "1공장 생산능력으로 2027년 매출 32억이 가능한가?"를 예산 3,000/5,000/6,500/8,000자로 물었습니다. **4/4** 모두 컨텍스트에 "월 최대 25만 세트"가 들어갔고, 답은 "25만 × 12 × 165원 = 495,000,000원(4.95억 원) … 1공장만으로는 크게 못 미침 … 뒷받침되지 않음"이었습니다(148원 기준 4.44억도 함께 제시). 패킹 수정 전에는 3개 예산 중 3개에서 25만 줄이 빠져 판단을 보류했습니다. 회귀: `queries.mjs` **10/10**, 수치-인용 정밀도 **34/34**, `ui.mjs` 17/17 |
| 문서 전환 시 이전 문서의 ready로 `/pages/overview` 404 | `ready`는 `status.docId === docId`일 때만 참입니다. 문서를 바꾸면 이전 page/raw 뷰를 바로 비웁니다 | ready→실패 문서, ready→ready 전환 모두 404·콘솔 오류 0 |
| 추출 단계에서 실패한 문서가 새로고침 뒤 사라짐 | 목록이 meta.json 없이 status만 있는 문서도 보여 줍니다(`error` 필드 포함). 원본 PDF를 텍스트 추출 **전에** 저장하므로 "다시 시도"(reingest)가 됩니다 | 새로고침 뒤에도 `?doc=` 유지, 목록에 "Invalid PDF structure." 표시, "다시 시도" 버튼 202. `d-03-failed-doc-after-reload.png` |
| 질의 결과가 탭 전환 뒤 사라지고, 문서를 바꿔도 남음 | QueryPanel을 숨김 상태로 마운트를 유지합니다(`hidden`). `key={docId}` | 칩 → 위키 → 질의 복귀 시 결과 유지, 문서를 바꾸면 결과와 입력 초기화. `d-04-query-kept.png` |
| 128p 주요-수치에서 SOM 210억이 340억 쪽(p.63)을 인용하고 충돌 표시 없음 | 원문 대조 검증기(위 ④)를 넣었습니다. 기존 위키에는 `POST /api/wiki/docs/{id} {action:"verify-numbers"}`로 LLM 없이 다시 적용합니다 | SOM 행: `⚠ 2029년 210억 원 … [원문 대조] p.63에는 340억`. 근거 없는 인용 제거: 128p 128개, proposal 66개, 발췌 24개, 덱 0개. 다시 실행하면 0/0(멱등). 쪽마다 직접 표본을 확인함(예: proposal p.5에는 "14명" 없음 → 임직원 수 인용에서 빠짐). `d-02-large-som-conflict.png` |
| 모바일에서 샘플이나 문서를 눌러도 화면 변화 없음 | 모바일에서는 문서 선택 뒤 ready면 위키 뷰로, 진행 중이면 진행 카드로 스크롤합니다 | 390×844: 샘플 탭 후 scrollY 0 → 1558, 탭 바가 헤더 바로 아래(64px). `m-01-after-sample-tap.png`, `m-02-after-doc-tap.png` |
| 사소한 것들 | (a) 오래된 status의 provider 원시 JSON을 "auto→openai (claude 비활성: 사용 한도 초과)"로 줄임 (b) lint `against`가 없는 문서면 404, 없는 docId의 `/pages`도 404 (c) 파일명의 괄호와 문장부호를 보존(경로로 쓰지 않음) | curl로 확인: 404 / 404. 업로드한 `리뷰 (테스트) 30-45.pdf` 이름 그대로 표시 |

- 표 열 폭도 고쳤습니다. 긴 값(자금 배분 등)에 `nowrap`이 걸려 표가 867px로 넘치고 출처·비고 열이 가려지던 문제입니다. 이제 데스크톱에서 넘침 없이 694/694px입니다.

### 리뷰 2차 수정 검증 (fix-r2, 2026-11-12) — **두 제공자 모두 장애 중에 검증**

검증 시점의 제공자 상태(`node --env-file=.env.local wiki/scripts/probe-providers.mjs`): OpenAI `429 insufficient_quota`("You have no credits remaining"), Claude `400 usage limits`(12/1 복구). 그래서 아래는 **장애 상황의 동작**을 실측한 것입니다. 정상 상황의 품질 수치는 위 측정 결과(OpenAI 경로)를 보세요.

| 리뷰 지적 | 수정 | 확인 (명령 → 결과) |
|---|---|---|
| (major) 제공자 장애 시 select 23.2초, answer:true는 46초 뒤 HTTP 500으로 컨텍스트까지 버림, lint 500, UI는 영어 원문 오류 | `lib/llm.ts` 회로 차단기 + 쿼터 429 재시도 끔 + `withRetry`가 비재시도 오류를 즉시 던짐. select는 5초 데드라인 한 번만 시도하고 실패하면 어휘 매칭(`selectError`에 한국어 사유). **answer 실패는 throw하지 않고** `answerError`(한국어)와 함께 컨텍스트·선택 페이지를 200으로 돌려줌. 저하된 결과는 캐시하지 않음(복구되면 바로 LLM 경로). lint는 LLM 단계를 best-effort로 돌려 결정적 이슈 + `llmError`로 200(저하된 보고서는 저장된 마지막 정상 보고서를 덮어쓰지 않음). `lib/errors.ts`가 제공자 오류를 한국어 문장과 다음 행동으로 바꾸고 UI의 모든 오류 표시가 이를 거침. LlmUnavailableError → HTTP 503 | curl `{"query":"2공장 가동 시점은?","answer":true}`: **23.2초 → 1.29초**(첫 호출: Claude 0.5초 + OpenAI 0.7초 시도 후 차단기 열림), 이후 **10~40ms**, 모두 200 + 컨텍스트 5,817자 + `answerError`. lint POST 26초 500 → **55ms 200**(결정적 이슈 4건 + llmError). `node wiki/tests/fix-r2-degraded.mjs` → 7개 질의 모두 200, 11~46ms, 기대 수치가 **컨텍스트에 13/13** 포함(`.verify/wiki/fix-r2/degraded-queries.json`). UI `node wiki/tests/fix-r2-ui.mjs` → **19/19 PASS**: 질의 결과 254ms에 표시(선택 페이지 4개 + 컨텍스트 + "답변을 만들지 못했습니다" 한국어 카드), 콘솔 오류 0, `/api/wiki` 5xx 0. `m-03-query-full.png`, `d-04-lint.png` |
| 잘못된 multipart 업로드가 500 | `req.formData()` 실패를 400으로 | curl `--data-binary garbage` → **400** "multipart 본문을 읽을 수 없습니다" |
| 소형 문서의 '압축' 컨텍스트가 전문의 223.7% | 원문 전체가 예산 절반 안에 들어가면 원문이 곧 컨텍스트입니다. 위키 페이지를 덧붙이지 않고 **작은 주요-수치 블록**(문서 안 충돌 + 질문 관련 행, 원문의 15% 또는 400자 이내)만 붙입니다. LLM 선택도 건너뜀. UI는 "소형 문서: 원문 전체 + 주요 수치 요약"으로 표시 | presentation "발표자료에서 SOM은?": 5,999자(223.7%) → **2,924자(109%)**, 17ms, 340억·5% 모두 포함. `d-05-small-doc-query.png` |
| index 한 줄 요약이 편집 메모("기존 내용과 동일", "…를 추가") | `applyOp`가 편집 메모형 summary면 이전 요약을 유지(`reground.ts pageSummary/isDeltaSummary`), finalize와 `repairWiki`가 남은 것을 본문 첫 "> " 줄로 복원 | `POST /repair`: proposal 7개, 128p 8개 복원. 예: 시장-규모 "기존 내용과 동일" → "국내 보호 포장재 TAM 4.2조 원, SAM 6,800억 원, 2029년 SOM 210억 원이다." 전후 비교 `.verify/wiki/fix-r2/index-before-cb3e.md` |
| 수치 인용의 2~4%가 그 수치가 없는 쪽을 가리킴 | 추출 단계 폴백을 "청크 첫 쪽" → "수치가 실제로 적힌 청크 안 쪽"으로, finalize에 본문 전체 결정적 재근거화(위 ④) 추가, 기존 위키는 `/repair` | 리뷰어 감사 스크립트 `node wiki/tests/review-r2-citeaudit.mjs <doc>`: proposal 388/396(98.0%) → **396/396(100%)**, 128p 521/541(96.3%) → **538/541(99.4%)**, 덱 80/80. 남은 3건은 원문에 없는 표기(“2.0만”, “1.1억”: 원문 표 형식이 달라 문자열이 다름). 예: 고객-세일즈 "대량 계약 148원 (p.52)" → "(p.51, p.52)", p.51에 그 문장 그대로 있음. 두 번째 실행 0건(멱등) |
| '위키 페이지로 저장'이 질의를 다시 돌려 화면과 다른 답을 저장 | 새 `saveAnswer(docId, {query, answer, pages})` + `POST /docs/{id}/answers`. UI는 화면에 보이는 답변 그대로 보냄(LLM 호출 0회, 제공자 장애 중에도 동작) | curl로 저장 → 페이지 본문 = 보낸 답변 그대로, index·log 기록 확인. 잘못된 본문 400 |
| 모바일 문구 '왼쪽 진행 상황', 인제스트 실패 문구가 영어 원문 | "인제스트 진행 카드(모바일은 위, 데스크톱은 왼쪽)"로. 실패는 한국어 사유 + "다시 시도" 안내. 인제스트도 차단기 덕분에 즉시 실패 | 새 3쪽 PDF 업로드: **2초 안에** "위키를 만들지 못했습니다. AI 제공자를 쓸 수 없습니다 (Claude 사용 한도 초과, OpenAI 크레딧 소진). 크레딧을 충전하거나… ‘다시 시도’를 누르세요." `m-02-upload-result.png`. 예전 상태 파일의 영어 오류(“429 You have no credits…”, “Invalid PDF structure”)도 화면에서는 한국어로 바뀜 |

### 리뷰 3차 수정 검증 (fix-r3, 2026-11-13) — 제공자 장애 중

| 지적 | 수정 | 검증 |
|---|---|---|
| (major) "위키 다시 만들기"가 LLM 호출 전에 wiki/와 state 파일을 지워, 실패하면 0페이지 error 문서가 되고 query/lint 409, question/report도 깨짐 | 위 "다시 만들기" 항목(스테이징 + 원자적 교체 + 실패 시 유지 + `lastReingestError` + 503 프리플라이트). `reingest`가 원본 해시가 아니라 **받은 docId**로 작업하도록 바꿈(복사한 문서 디렉터리가 원본 문서를 다시 만들던 문제). 202 응답 전에 초기 상태를 기록해 UI가 바로 진행을 봄. 확인 창: "새 위키가 다 만들어질 때까지 지금 위키는 그대로 … 실패하면 지금 위키를 그대로 유지" | **라이브(:3100), 샌드박스** `00000000deadbeef`(presentation 복사, meta/status의 docId·파일명 수정 → 목록·meta 일치): 기본 reingest → **503** "지금은 사용할 수 있는 AI 제공자가 없어 위키를 다시 만들 수 없습니다 (Claude 사용 한도 초과, OpenAI 크레딧 소진). 지금 위키는 그대로 유지됩니다…"(2.8초, 파일 변화 0). `preflight:false` → 202 직후 `state=ready rebuild=extracting` → 실패 후 `ready + lastReingestError`, 페이지 16·keynumbers 50·lint 200, wiki/state 지문(md5) **동일**, query 200, lint 200, 스테이징 디렉터리 0. UI: 실패 배너 + 503 사유 카드 + 확인 창 문구 확인, 삭제 버튼으로 샌드박스 정리. **모의 하네스** `node wiki/tests/fix-r3-staging.mjs` → **24/24 PASS**(실제 lib을 임시 루트에서 실행, `@/lib/ai`만 가짜: 실패 빌드 중 18회 폴링 동안 ready·질의·이전 페이지 유지 → 지문 동일; **성공 빌드**는 진행 중 이전 위키 제공 후 교체, lint 제거, log 기록 99→107로 이어짐, `.next/.prev` 0; 프리플라이트 503; 삭제) |
| `saveAnswer`/`POST /answers`가 ready가 아니어도 저장 | ready 아님 → 409 "위키가 아직 준비되지 않았습니다 (error)…", 다시 만드는 중 → 409. `queryWiki({save})`는 throw 대신 `saveError` | error 문서에 POST → 409, 없는 문서 404 |
| 저장 slug가 질의 앞 5단어라 충돌 | `질의-<앞 5단어>-<전체 질의 sha1 6자>`. 같은 질의는 같은 페이지 갱신 | 앞 5단어가 같은 두 질의 → `…-근거는-0a6310` / `…-경쟁사-1dd3f6` |
| log.md가 query로 도배(266개 중 232개) | 위 log.md 규칙 + `node wiki/scripts/compact-logs.mjs`(멱등, 기존 log의 query 줄을 `log-queries.md`로 옮기고 답변·저장된 질의만 1회씩 남김) | proposal 288→63줄(query 254→29), presentation 99→18, 128p 50→39. ingest/plan/merge/lint 줄 수 전후 동일. 두 번째 실행 변화 0. 백업은 리뷰 세션 scratchpad |
| 리뷰가 남긴 error 문서가 목록을 어지럽힘 | `DELETE /api/wiki/docs/{id}`(작업 중이면 409, 디렉터리를 rename 후 삭제) + 진행 카드 "삭제" 버튼(확인 창) | meta/status 확인 후 `broken.pdf`, `리뷰 (테스트) 30-45.pdf`, `리뷰2 발췌 p10-33.pdf`(모두 error, 위키 0p) 삭제 → 200. 목록: ready 4개(12/16/58/128쪽)만 남음 |
| 없는 docId의 `/events`가 200 `data:null` | 404 `unknown docId`. rebuild 중에는 `status.rebuild`가 끝날 때까지 스트림 유지 | 404 / 잘못된 id 400 / 정상 문서 `data:` |

- 기존 회귀: `fix-r2-degraded.mjs` 7개 질의 모두 200(13~1442ms), lint 200 + llmError. `fix-r1.mjs`는 15/19: 실패 4건은 모두 이번에 지운 error 문서 `56cccdc7…`("리뷰 (테스트) 30-45.pdf")를 전제한 항목입니다(실패 문서 표시·다시 시도·괄호 파일명). 그 항목을 다시 보려면 깨진 PDF를 올려 error 문서를 만든 뒤 스크립트의 `BROKEN` id를 바꾸세요.

### API 엣지 케이스 (curl)

- 같은 PDF를 다시 올리면(JSON 샘플이든 multipart든) 200 `reused:true`를 16ms 안에 돌려줍니다.
- 그 밖의 경우는 아래와 같습니다.

| 입력 | 응답 |
|---|---|
| PDF가 아닌 파일 | 400 |
| 잘못된 docId | 400 |
| 없는 docId (`/docs/{id}`, `/pages`, lint `against`) | 404 |
| `..%2F` 경로 조작 slug | 404 |
| 범위 밖 raw 쪽 | 404 |
| 한글 slug | 200 |
| ready 문서의 SSE | 1회 전송 후 종료 |
| 빈 query | 400 |
| 깨진 multipart 본문 | 400 |
| `/answers`에 query·answer 없음 | 400 |
| ready가 아닌 문서에 `/answers` | 409 |
| 없는 docId의 `/events` | 404 |
| `DELETE /docs/{id}` 없는 문서 / 작업 중 | 404 / 409 |
| 제공자 없이 reingest | 503 (한국어, 아무것도 시작 안 함) |
| 제공자 장애 중 query (answer 포함) | 200 + `answerError` (컨텍스트 유지) |
| 제공자 장애 중 lint POST | 200 + `llmError` (결정적 이슈만) |

- `.next/static`에서 API 키 문자열을 검색했을 때 0건이었습니다.

## 라이브러리 계약 (안정 API: 다른 PoC는 이것만 import)

```ts
import { ingestPdf, startIngest, reingest, waitForWiki, getWikiStatus, listDocs, getDocMeta,
         listWikiPages, readWikiPage, readRawPage, queryWiki, saveAnswer, lintWiki, getKeyNumbers,
         repairWiki, llmAvailable, LlmUnavailableError, friendlyLlmError } from "@/wiki/lib";
import type { QueryResult, LintReport, KeyNumber, WikiStatus } from "@/wiki/lib/types"; // 클라이언트에서도 import 가능
```

`@/wiki/lib`은 서버 전용(`server-only`)입니다. 클라이언트에서는 HTTP API를 쓰세요.

| 함수 | 시그니처 | 설명 |
|---|---|---|
| `ingestPdf` | `(buf: Buffer, filename: string, opts?: { kind?: "presentation" \| "proposal"; force?: boolean; onProgress?: (e: IngestEvent, s: WikiStatus) => void }) => Promise<{ docId; reused }>` | **완료까지 기다립니다.** 실패하면 throw합니다. `kind`를 생략하면 1쪽의 가로/세로 비율로 추정합니다 |
| `startIngest` | 같은 인자 | 백그라운드로 실행합니다(UI·API용) |
| `reingest` | `(docId, { preflight?=true }) => Promise<{ docId; reused }>` | 저장된 원본으로 다시 만듭니다. ready 위키는 스테이징에서 만들어 성공 시에만 교체(그동안·실패 후에도 ready, `status.rebuild` / `status.lastReingestError`). 제공자가 없으면 `LlmUnavailableError`(503) |
| `deleteDoc` | `(docId) => Promise<{ docId; deleted }>` | 문서 디렉터리 전체 삭제. 작업 중이면 throw(409) |
| `waitForWiki` | `(docId) => Promise<WikiStatus>` | ready가 될 때까지 기다립니다. error면 throw합니다. 다시 만들기 중인 ready 위키는 기다리지 않고 바로 돌려줍니다 |
| `getWikiStatus` | `(docId) => Promise<WikiStatus \| null>` | 상태, 진행률, 토큰, 이벤트를 돌려줍니다 |
| `listDocs` / `getDocMeta` | | 문서 목록과 메타(쪽수, 문자 수, 빈 쪽 등) |
| `listWikiPages` | `(docId) => Promise<WikiPageInfo[]>` | `{ slug, title, type, summary, sources, links, chars }` |
| `readWikiPage` | `(docId, slug) => Promise<string \| null>` | 마크다운 원문입니다. `index`, `log`, `SCHEMA`, `overview`, `주요-수치`도 읽힙니다 |
| `readRawPage` | `(docId, page) => Promise<string \| null>` | 불변 원문(1부터 시작하는 쪽 번호) |
| `queryWiki` | `(docId, query, { maxContextChars?=6000, maxPages?=4, answer?, followLinks?=true, save?, selector?: "llm" \| "lexical", includeRaw?=true, selectTimeoutMs?=5000, answerTimeoutMs?=60000 })` | → `QueryResult { context, pages, selected, answer?, answerError?, selectError?, citations, contextChars, fullTextChars, approxTokens, truncated, selector, mode, timings }`. **제공자가 죽어도 throw하지 않습니다**: 선택은 어휘 매칭으로 넘어가고(`selectError`), 답변 실패는 `answerError`(한국어)로 옵니다. `context`는 항상 유효합니다. throw하는 경우는 docId 없음·not ready·빈 query뿐입니다. 정상 결과만 메모리에 캐시하며, 캐시 키에 index mtime이 들어갑니다 |
| `saveAnswer` | `(docId, { query, answer, pages? }) => Promise<{ savedAs }>` | 이미 받은 답변을 그대로 analysis 페이지로 저장합니다(LLM 0회). index·log 갱신. slug = `질의-<앞 5단어>-<질의 해시 6자>`. ready가 아니거나 다시 만드는 중이면 throw(409) |
| `lintWiki` | `(docId, { against?: docId })` | → `LintReport { issues[…], llmError? }`. LLM 단계가 실패하면 결정적 이슈만 담고 `llmError`(한국어)를 채워 돌려줍니다(throw 안 함, 이 경우 저장된 마지막 보고서는 유지). 정상 결과는 `state/lint*.json`에 저장합니다 |
| `repairWiki` | `(docId) => Promise<{ citationGroups, citationsFixed, pagesAdded, summariesFixed, … }>` | 결정적 정비(LLM 0회, 멱등): 본문 수치 인용 재근거화 + 편집 메모형 요약 복원 + 주요-수치 대조 + index 재생성 |
| `llmAvailable` / `probeLlm` / `LlmUnavailableError` / `friendlyLlmError` | | 지금 쓸 수 있는 제공자가 있는지(차단기 기준) / 실제 1회 호출로 확인(없으면 LlmUnavailableError) / 모든 제공자가 막혔을 때의 오류(`code`, `detail`) / 제공자 오류 → 한국어 문장(`@/wiki/lib/errors`는 클라이언트에서도 import 가능) |
| `getKeyNumbers` | `(docId) => Promise<KeyNumber[]>` | `{ metric, value, pages, note, conflict, unverified? }`. `pages`는 원문 대조를 통과한 쪽입니다. `unverified`는 LLM이 인용했지만 원문에 그 값이 없는 쪽입니다. 일관성 검사와 리포트 표에 바로 쓸 수 있습니다 |
| `reverifyKeyNumbers` | `(docId) => Promise<{ rowsChecked, droppedCitations, newConflicts, conflicts }>` | 기존 위키의 주요-수치에 원문 대조를 다시 적용합니다(LLM 0회, 멱등) |

### question/report 에이전트 권장 사용법

```ts
// 세션 준비: 두 자료 인제스트 (이미 있으면 즉시 반환)
const { docId: pres } = await ingestPdf(deckBuf, "deck.pdf", { kind: "presentation" });
const { docId: prop } = await ingestPdf(planBuf, "plan.pdf", { kind: "proposal" });

// 질문 생성: 전사 문장의 주제로 컨텍스트만 가져오기 (전문 대신 ~6%)
const { context } = await queryWiki(prop, "단위 원가와 매출총이익률", { maxContextChars: 4000 });
// 심사위원 프롬프트에 context 삽입 + "(p.N) 인용 유지" 지시. 지연이 중요하면 selector: "lexical"(LLM 0회)
// 제공자 장애 중에도 context는 그대로 옵니다(answer를 요청했다면 answerError 확인).

// 리포트: 자료 품질·일관성
const mismatch = await lintWiki(pres, { against: prop });   // 덱↔제안서 수치 불일치 (cross-doc-mismatch)
const gaps = await lintWiki(prop);                            // 근거 없는 가정·단일 공급처 등 (gap)
const nums = await getKeyNumbers(prop);                       // 주요 수치 표
```

## HTTP API (`/api/wiki`)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/wiki/docs` | 문서 목록(추출 단계에서 실패한 문서도 `state:"error", error`로 포함) |
| POST | `/api/wiki/ingest` | multipart(`file`, `kind?`), 최대 50MB. 또는 JSON `{ sample: "presentation" \| "proposal" \| "large", kind? }` → 202 `{docId, reused:false}` 또는 200 `{reused:true}` |
| GET | `/api/wiki/docs/{docId}` | `{ meta, status, keyNumbers }` |
| POST | `/api/wiki/docs/{docId}` | `{ action: "reingest" }` → 원본으로 다시 만들기(202, ready 위키는 성공 시에만 교체). 제공자가 없으면 503(한국어). `preflight:false`는 프리플라이트를 건너뜀(실패 경로 테스트용). `{ action: "verify-numbers" }` → 주요-수치 원문 대조 재적용(200) |
| DELETE | `/api/wiki/docs/{docId}` | 문서 삭제(원본 PDF·위키·상태). 없으면 404, 작업 중이면 409 |
| GET | `/api/wiki/docs/{docId}/events` | SSE `data: WikiStatus`. 상태가 바뀔 때마다 보내고 ready/error에서 종료합니다(다시 만들기 중이면 `rebuild`가 사라질 때까지). 없는 문서는 404 |
| GET | `/api/wiki/docs/{docId}/pages` | `WikiPageInfo[]` |
| GET | `/api/wiki/docs/{docId}/pages/{slug}` | `text/markdown` |
| GET | `/api/wiki/docs/{docId}/raw/{page}` | `text/plain` 원문 쪽 |
| GET | `/api/wiki/docs/{docId}/pdf` | 원본 PDF(`#page=N`) |
| POST | `/api/wiki/docs/{docId}/query` | `{ query, maxContextChars?, maxPages?, answer?, save?, selector?, followLinks? }` → `QueryResult` (제공자 장애 시에도 200 + `answerError`/`selectError`) |
| POST | `/api/wiki/docs/{docId}/answers` | `{ query, answer, pages? }` → `{ savedAs }`. 화면에 보인 답변을 그대로 위키에 저장. ready가 아니거나 다시 만드는 중이면 409 |
| POST | `/api/wiki/docs/{docId}/repair` | 결정적 정비(인용 재근거화, 요약 복원, 주요-수치 대조, index 재생성) → 통계 |
| GET / POST | `/api/wiki/docs/{docId}/lint` | GET은 마지막 보고서(없으면 `null`)를 돌려줍니다(`?against=`). POST `{ against? }`는 점검을 실행합니다 |

## 파일 구성

```
wiki/lib/types.ts      공용 타입 (클라이언트 OK)
wiki/lib/markdown.ts   frontmatter·[[link]]·(p.N) 파서, slug 정규화 (클라이언트 OK)
wiki/lib/llm.ts        provider 추상화(auto: Claude→OpenAI), 회로 차단기, 단계별 모델, pool/withRetry
wiki/lib/errors.ts     제공자 오류 → 한국어 문장/다음 행동 (클라이언트 OK)
wiki/lib/reground.ts   본문 수치 인용 재근거화 + index 요약 정리 (순수 함수)
wiki/lib/prompts.ts    SCHEMA.md 본문, 단계별 프롬프트 + zod 스키마
wiki/lib/store.ts      .data/wiki 레이아웃, 원자적 쓰기, 페이지·raw 접근
wiki/lib/ingest.ts     INGEST 파이프라인, 작업 레지스트리, index 재생성
wiki/lib/numbers-verify.ts  주요-수치 원문 대조(결정적, 순수 함수)
wiki/lib/query.ts      QUERY (선택→링크 홉→예산 배분→답변→저장)
wiki/lib/lint.ts       LINT (결정적 + LLM + raw 재근거화, 문서 간 비교)
wiki/lib/http.ts       API 공용 (샘플 경로, 오류 매핑)
wiki/components/       WikiStudio(업로드·진행·브라우저·질의·점검·log), Markdown(안전 렌더러)
wiki/tests/            queries.mjs, lint.mjs, ui.mjs, progress.mjs, fix-r1.mjs·fix-r2-ui.mjs·fix-r2-degraded.mjs·fix-r3-staging.mjs(리뷰 수정 회귀), review-*.mjs(리뷰어 스크립트)
wiki/tests/r3/         hooks.mjs(서버 없이 TS lib 실행: typescript 변환 + @/ 해석 + server-only 스텁), mock-ai.mjs(가짜 @/lib/ai)
wiki/scripts/          probe-llm.mjs(모델 지연 측정), probe-providers.mjs(제공자 상태), probe-abort.mjs, wait-status.mjs, compact-logs.mjs(log.md의 query 줄 → log-queries.md)
wiki/fixtures/large-128p.pdf   합성 대용량 PDF (proposal+presentation+proposal)
app/wiki/page.tsx, app/api/wiki/**   얇은 라우트
```

## HIL 체크리스트 (사람이 해 볼 것)

1. http://localhost:3100/wiki 를 휴대폰 폭과 데스크톱에서 엽니다. 위키 목록에 3개 문서(12/58/128쪽)가 "완료"로 보이는지 확인합니다.
2. `proposal.pdf`의 **overview**를 읽고 "검토 포인트"가 심사위원 시각에서 쓸모 있는지 판단합니다. 본문의 `[[링크]]`를 눌러 페이지를 이동해 봅니다.
3. 아무 `p.N` 칩이나 `+N쪽` 칩을 눌러 raw 원문 시트를 엽니다. 시트 위쪽 목록에 그 인용의 모든 쪽이 나오고, ‹ ›가 그 쪽들만 이동하는지 봅니다. 그 문장이 원문에 실제로 있는지 3~4개 무작위로 대조합니다. "PDF에서 N쪽 열기"도 눌러 봅니다.
4. **주요-수치** 페이지에서 142원, 약 14%, SOM 210억, 20억, 83%가 맞는지 확인합니다. presentation.pdf에서는 118원, 28%, 340억을 확인합니다. large-128p.pdf에서는 SOM 행에 ⚠와 "[원문 대조] p.63에는 340억"이 보이는지 확인합니다.
4-1. 질의 탭에서 "1공장 생산능력으로 2027년 매출 32억이 가능한가?"를 물어봅니다. 답이 계산식(25만×12×165원 ≈ 4.95억)을 보이고 "뒷받침되지 않는다"고 하는지 확인합니다.
5. **질의** 탭에서 예시 질문과 직접 만든 질문(예: "경쟁사 대비 가격 경쟁력은?", "2공장은 언제 가동?")을 넣어 봅니다. 답변과 인용 쪽이 맞는지, 컨텍스트가 전문의 몇 %인지 봅니다. 예산 슬라이더를 1,500자까지 줄였을 때 답이 무너지는지도 확인합니다.
6. 답변 아래의 "위키 페이지로 저장"을 누릅니다. 페이지 목록과 index에 `질의-…` analysis 페이지가 생기고, **본문이 화면의 답변과 똑같은지**, log에 기록되는지 봅니다.
6-1. **제공자 장애 상황**(지금처럼 크레딧 소진 상태이거나 `.env` 키를 일부러 틀리게 한 상태): 질의가 1~2초 안에 선택 페이지·컨텍스트와 함께 "답변을 만들지 못했습니다" 한국어 카드를 보이는지, 점검이 결정적 이슈와 한국어 안내를 보이는지, 새 PDF 업로드가 몇 초 안에 한국어 사유로 실패하는지 확인합니다. 크레딧을 충전한 뒤 1분 안에 같은 질의가 LLM 경로로 돌아오는지도 봅니다.
7. **점검** 탭에서 proposal.pdf의 비교 문서로 presentation.pdf를 고르고 점검을 실행합니다. 원가, 이익률, SOM 불일치 3건이 high로 나오고 양쪽 쪽 번호가 맞는지 확인합니다.
8. 직접 가진 PDF(가능하면 50쪽 이상)를 올립니다. 진행 카드에서 청크 n/m, 라운드 n/m, 생성·갱신 수가 실시간으로 바뀌는지 봅니다. 결과 위키의 구조(페이지 분할)가 자연스러운지 판단합니다.
9. 같은 PDF를 다시 올리면 바로 재사용되는지("완료" 상태 그대로) 확인합니다. "위키 다시 만들기"를 누르면(제공자가 살아 있을 때) 진행 카드 제목이 "위키 다시 만드는 중"으로 바뀌고, **그동안 위키 탭·질의가 이전 위키로 계속 동작**하다가 완료 시 새 위키로 바뀌는지 확인합니다. 제공자가 없으면 즉시 한국어 503 사유가 카드에 뜨고 위키는 그대로인지 봅니다.
10. **log** 탭에서 ingest, plan, merge, finalize, lint, 답변이 생성·저장된 query 기록이 시간순으로 쌓이는지 확인합니다. 머리말의 [[log-queries]] 링크로 전체 질의 기록도 열어 봅니다.
11. 테스트용으로 올린 문서를 진행 카드의 "삭제"로 지워 봅니다(확인 창 → 목록에서 사라짐).

## 알려진 한계

- **다시 만들기의 성공 경로는 실제 LLM으로 아직 검증하지 못했습니다**(제공자 장애). 교체 로직은 모의 하네스(`fix-r3-staging.mjs`, 실제 lib + 가짜 AI 클라이언트)로 검증했습니다. 교체는 디렉터리 rename 두 번이라 그 사이 수 μs 동안 `wiki/`가 없을 수 있고(그 순간의 읽기는 404/빈 목록), 그 사이 서버가 죽으면 `wiki.prev`/`wiki.next`가 남을 수 있습니다(자동 복구 없음, 다음 다시 만들기가 정리). 교체 직전에 들어온 질의 기록 몇 줄은 log-queries.md에서 빠질 수 있습니다. 실패한 빌드의 아직 끝나지 않은 병렬 LLM 호출이 곧바로 시작한 다음 다시 만들기의 스테이징에 쓸 가능성도 이론상 있습니다.
- 다시 만들기가 성공하면 이전 위키의 저장된 analysis(질의-…) 페이지와 lint 보고서는 사라집니다(새 위키 기준이 아니므로). 필요하면 다시 저장하세요.
- **(2026-11-12 현재) OpenAI 크레딧 소진 + Claude 사용 한도(12/1까지)** 상태입니다. 이 상태에서는 새 인제스트가 즉시 실패하고, 질의는 어휘 매칭 선택 + 컨텍스트만, 점검은 결정적 항목만 동작합니다. 이미 만들어진 위키 4개(12/16/58/128쪽)는 열람·질의 컨텍스트·인용 시트 모두 정상입니다. 크레딧을 충전하면 코드 변경이나 재시작 없이 1분 안에 LLM 경로로 돌아옵니다. fix-r2의 인제스트 쪽 변경(추출 폴백·요약 유지·finalize 재근거화)은 같은 결정적 함수를 기존 위키에 `/repair`로 적용해 검증했고, **새 인제스트 전체 실행으로는 아직 검증하지 못했습니다**.
- 본문 인용 재근거화는 문자열 대조라 같은 값을 다르게 쓴 경우("2.0만" vs 표의 "2.0 만 세트")는 못 고칩니다. 쪽을 **추가**만 하고 지우지 않으므로, 수치와 무관한 원래 쪽이 인용에 남을 수 있습니다.
- 소형 문서 모드(raw+wiki)의 주요-수치 블록은 어휘 매칭으로 고르므로 질문과 무관한 행이 한두 개 섞일 수 있습니다(원문 전체가 이미 들어 있어 정보 손실은 없음).

- **Claude 경로를 실호출로 검증하지 못했습니다**(키 한도, 2026-12-01 복구). 코드는 SDK 타입에 맞췄고 tsc를 통과했으며, 실패하면 OpenAI로 자동 폴백합니다. 복구 뒤 `WIKI_LLM_PROVIDER=claude`로 회귀 테스트가 필요합니다.
- 스캔 PDF(텍스트가 없는 PDF)는 OCR이 없어 거부합니다. 표와 차트 이미지 안의 숫자는 PDF 텍스트 레이어에 있을 때만 들어옵니다. 덱의 SVG 차트 라벨은 추출됩니다.
- 위키 품질은 LLM 출력에 따라 실행마다 조금씩 다릅니다. 예를 들면 페이지 분할이 다르거나, 사소한 `[불일치]`를 과하게 표시하거나(실제로는 연도 기준 차이), 고아 페이지가 생깁니다. 숫자와 인용은 raw 대조 테스트로 확인했지만 모든 문장을 검증한 것은 아닙니다.
- 문서 간 비교는 `lintWiki(a, {against: b})`의 LLM 판단에 의존합니다. 수치 매칭을 결정적으로 하지 않습니다. 단, 인용은 raw로 다시 근거를 찾습니다.
- 128쪽 문서에 약 4분이 걸립니다. 직렬 병합 라운드(최대 5)가 절반을 차지합니다. 인제스트 중에는 위키 탭이 열리지 않습니다(완료 후 열람).
- 상태와 작업 레지스트리는 단일 Node 프로세스를 전제합니다(PoC). 저장소는 파일시스템(`.data/wiki`)이고 동시 쓰기는 문서 단위 단일 작업으로 막습니다.
- 토큰 근사치(`approxTokens`, 0.6 tok/자)는 이 코퍼스에서 실측한 대략값입니다.
- 원문 대조는 문자열 대조입니다. 같은 값을 다르게 쓴 경우("1.2억" vs "120,000,000원", "1년 4개월" vs "16개월")에는 근거 있는 인용을 뺄 수 있습니다. 단, 모든 인용이 빠지는 경우에는 원래 인용을 유지합니다. 충돌 탐지는 항목 이름 전체가 원문에 그대로 있고 바로 뒤 30자 안에 같은 단위의 다른 수치가 있을 때만 작동합니다. 그래서 놓치는 경우(false negative)가 있습니다. 예를 들어 128p의 "SOM 비중 3.1%" 행은 p.63(5%)을 인용하지 않아 충돌로 잡히지 않습니다. 문서 간·인용 밖 충돌은 LINT가 맡습니다.
- 답변은 판단 질문에서 보수적으로 동작합니다. 선택된 컨텍스트에 계산에 필요한 수치(예: 판매가)가 없으면 판단을 보류합니다. 128p 문서는 패킹 수정 전에 보류했고, 수정 뒤에는 "25만 ÷ 고객당 1.5만 × 250만 원 → 연 약 5억 → 뒷받침되지 않음"으로 답했습니다. 계산 경로는 실행마다 다를 수 있습니다.

## 다음 단계

- 실제 앱: 인제스트를 업로드 직후 백그라운드로 시작합니다(사용자가 상황을 설정하는 동안 완료). `SessionRecord.presentationDocId/proposalDocId`에 연결합니다.
- 결정적 수치 비교기: 두 문서의 `keynumbers`를 metric 정규화와 값 파싱으로 비교해 LLM 없이 불일치를 1차로 찾습니다.
- 병합 속도 개선: 라운드 수를 적응형으로 정하고, 바뀌지 않는 페이지는 건너뛰고, append 전용 빠른 경로를 둡니다. 원문 페이지를 임베딩해 질의 선택을 보조합니다.
- Claude 복구 뒤: haiku/sonnet/opus 품질·지연을 비교하고, 문서 원문 프롬프트 캐싱을 적용합니다(병합 단계의 index와 SCHEMA prefix).
- OCR(이미지 PDF)과 표 구조 보존 추출을 추가합니다.
