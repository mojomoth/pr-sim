# PoC · 심사위원 생성 (`pocs/judge`)

> 요구사항: "OpenAI API 를 사용해서 얼굴 이미지 생성 · 랜덤으로 실사 이미지를 만듦 · 생성을 하기 위한 인풋은 단지 세 가지 (친절함, 빡셈, 공격적)"

사용자가 입력하는 값은 **성향(Temperament) 하나**뿐입니다: `friendly`(친절함) / `strict`(빡셈) / `aggressive`(공격적).
성별, 나이(32–64), 한국 이름, 헤어, 수염, 안경, 복장, 배경, 조명, 표정 변형은 생성할 때마다 서버가 무작위로 정합니다.
이렇게 정한 값으로 프롬프트를 만들고 `gpt-image-2`로 실사 헤드샷을 생성합니다.
결과는 이미지(webp), 256px 썸네일, 메타데이터 JSON으로 `.data/judge/`에 저장합니다.

- 웹: **http://localhost:3100/judge**
- 개발 관측: http://localhost:3100/devlog (poc = `judge`)

## Architecture & data flow

```
[UI /judge]  성향 칩 ─────────POST /api/judge {temperament, quality}──▶ generateJudge()
             "3명 한 번에" ───POST /api/judge/panel (NDJSON stream)──▶ startPanel() ─┐
                                                                                     │
generateJudge(temperament)                                                           │
  1. rollTraits(temperament, avoid)   ← judge/lib/traits.ts (순수 함수, 랜덤 + 패널 균형)  ◀┘
  2. buildPrompt(traits)              ← 프레이밍 고정(눈높이 정면, 머리~가슴, 얼굴 ≈40%)
  3. openai().images.generate({ model: gpt-image-2, size 1024x1024, quality low, webp q85, opaque })
  4. sharp → 256px 썸네일
  5. .data/judge/<id>.webp, <id>.thumb.webp, <id>.json  (JSON을 마지막에 써서 반쪽 레코드가 목록에 나오지 않게 함)
  ↓
GET /api/judge/image/<id>[?size=thumb|card]   (Cache-Control: immutable, ETag/304)
  card(512px)는 첫 요청 때 sharp로 만들어 <id>.card.webp로 디스크 캐시 → 갤러리 카드는 srcset(256/512/1024)으로 로드
```

- 성향은 표정과 태도에만 반영합니다(DESIGN.md "공격적 페르소나도 과장된 표정 대신"). 각 성향에 3가지 변형이 있습니다.
  - 친절함: 눈까지 웃는 부드러운 미소, 편안한 자세
  - 빡셈: 무표정하고 침착한 얼굴, 평가하는 시선
  - 공격적: 렌즈를 똑바로 보는 강한 시선, 굳은 턱, 회의적인 표정(화난 얼굴은 금지)
- 패널 생성(`startPanel`)은 **이름과 성(姓)이 모두 겹치지 않게** 하고(Q&A·TTS에서 "황 심사위원님"이 한 명만 가리키도록), 성별을 균형 있게 섞고, 나이 차를 6살 이상 두도록 미리 roll한 뒤 이미지를 병렬로 만듭니다.
  오프라인 시뮬레이션(`node --experimental-strip-types judge/tests/traits-sim.mjs`) 3인 패널 1000개: 남녀 혼합 93.6%, 성 중복 0%(회피 전 16.8%), 이름 중복 0%.

## Models & settings (and why)

| 항목 | 값 | 이유 |
|---|---|---|
| 모델 | `gpt-image-2` (`MODELS.openaiImage`) | 요구사항(OpenAI). 실사 인물 품질이 좋음 |
| size | `1024x1024` | 카드와 썸네일을 정사각형으로 맞추기 쉽고 표준 크기라 안정적 |
| quality | 기본 **`low`**. `medium`/`high`는 UI 하단 "개발용 옵션"에서만 선택(성향 외 입력을 늘리지 않기 위해) | 측정 결과 아래 표 참고. 카드나 원형 썸네일 크기에서는 low도 충분히 실사로 보임 |
| output | `webp`, `output_compression: 85`, `background: opaque` | 이미지 60–120KB. 썸네일은 sharp로 256px webp(약 4–6KB) |
| 재시도/타임아웃 | `maxRetries: 1`, `timeout: 180s` | high 화질은 90초 가까이 걸림 |

지연 측정(1024², webp; 실제 호출):

| quality | 측정값 |
|---|---|
| low | 7.9 – 17.5s (저장된 low 20건 중앙값 11.3s; 3명 병렬 패널 11.4–12.3s) |
| medium | 28.3s, 29.3s |
| high | 89.8s |

## Routes / API

| Method | Path | 설명 |
|---|---|---|
| GET | `/judge` | PoC UI |
| GET | `/api/judge` | `{ judges: JudgeRecord[] }` 최신순 |
| POST | `/api/judge` | body `{ temperament, quality?: "low"|"medium"|"high", replaceId? }` → `201 JudgeRecord`. `replaceId`를 주면 생성에 성공한 뒤 기존 심사위원을 삭제(다시 생성) |
| POST | `/api/judge/panel` | body `{ temperaments?: Temperament[] (기본 3종), quality? }` → `application/x-ndjson`. 이벤트: `start` · `judge{slot,judge}` · `error{slot,error}` · `done{ms}` |
| GET | `/api/judge/:id` | 메타데이터 |
| DELETE | `/api/judge/:id` | 204 / 404 |
| GET | `/api/judge/image/:id[?size=thumb\|card]` | `image/webp`. full 1024px(60–120KB) · `card` 512px(약 14–18KB, 첫 요청 때 생성 후 디스크 캐시) · `thumb` 256px(약 5KB). `Cache-Control: public, max-age=31536000, immutable`, ETag → 304. id는 재사용하지 않으므로 영구 캐시 가능 |

body는 JSON **객체**여야 합니다. 깨진 JSON, `null`, 배열, 원시값은 모두 `400 bad_request`입니다(단일·패널 공통).
오류 응답은 `{ error: { kind, message, title, hint } }` 형식이고 kind별 HTTP 상태는 다음과 같습니다.
moderation 422, rate_limit 429, auth 502, timeout 504, bad_request 400, server 502.
`title`과 `hint`는 UI에 그대로 보여 줄 한국어 문구입니다.
개발 환경에서는 body에 `simulateError: "moderation" | "rate_limit" | "timeout" | "server" | ...`를 넣으면 OpenAI를 호출하지 않고 해당 오류를 흉내 냅니다(UI 하단 "오류 화면 미리보기").

## Lib API (재사용: question / stt-tts / 실제 앱)

`import { ... } from "@/judge/lib"` (server-only)

```ts
generateJudge(temperament: Temperament, opts?: { quality?, avoid?, traits?, signal? }): Promise<JudgeRecord>
  // JudgeRecord ⊇ JudgePersona & { prompt: string; ms: number } — plus fullName, surname, voiceHint, traits, thumbUrl, quality, size, bytes, totalMs, createdAt
startPanel(temperaments: Temperament[], opts?): Promise<JudgeRecord>[]   // 패널 균형 roll 후 병렬 생성, 슬롯별 promise
generatePanel(temperaments, opts?): Promise<PromiseSettledResult<JudgeRecord>[]>
listJudges(): Promise<JudgeRecord[]>
getJudge(id): Promise<JudgeRecord | null>
deleteJudge(id): Promise<boolean>
toPersona(rec): JudgePersona & { fullName; voiceHint }   // 다른 PoC로 넘길 공용 형태
rollTraits(temperament, avoid?, rng?) / buildPrompt(traits) / voiceHint(traits, temperament)   // 순수 함수 (judge/lib/traits.ts)
```

- `name`은 `lib/types.ts` 계약에 맞춰 **이름만** 담습니다(예: "준호"). 성까지 붙인 이름은 `fullName`(예: "김준호")에 있습니다.
- TTS 음성은 `gender`, `age`, `voiceHint`(예: "40대 남성, 따뜻하고 부드러운 목소리")로 고르면 됩니다.
- 클라이언트에서 안전하게 import할 수 있는 타입과 문구는 `judge/lib/model.ts`(JudgeRecord, QUALITY_LABEL, `judgeSrcSet(j)`)와 `judge/lib/errors.ts`에 있습니다.
- 사진을 표시할 때는 크기에 맞는 변형을 쓰세요. 원형 아바타는 `?size=thumb`, 카드는 `?size=card` 또는 `srcSet={judgeSrcSet(j)}`, 큰 사진만 원본을 씁니다.
- `RollAvoid`는 `{ names, surnames, genders, ages }`입니다. 패널을 직접 roll할 때 넘기면 중복을 피합니다.

## Files

```
judge/lib/traits.ts      랜덤 요소 풀 + 프롬프트 빌더 (isomorphic, 순수)
judge/lib/index.ts       generateJudge / startPanel / list / get / delete (server-only)
judge/lib/store.ts       .data/judge 파일 저장소 (id 검증으로 path traversal 차단)
judge/lib/http.ts        라우트 공용 파싱/오류 응답
judge/lib/errors.ts      오류 종류 + 한국어 문구 (isomorphic)
judge/lib/model.ts       JudgeRecord, 화질 라벨 (isomorphic)
judge/components/*       JudgeStudio(UI), JudgeCard(카드/스켈레톤/오류), JudgeDetail(상세 시트), api.ts(fetch + NDJSON)
judge/tests/ui.mjs       헤드리스 UI 테스트 (`--live`면 실제 생성 E2E)
judge/tests/fixes.mjs    리뷰 1차 수정 검증 (상세 재생성 잠금, card 변형, 패널 스트림 조기 종료; 실제 재생성 1회)
judge/tests/review-ui.mjs  리뷰어가 쓴 UI 테스트
judge/tests/contact-sheet.mjs  최근 N명 콘택트 시트(.verify/judge/*.jpg)
judge/tests/traits-sim.mjs     랜덤 분포 오프라인 시뮬레이션
app/judge/page.tsx, app/api/judge/**   얇은 라우트 파일
```

## UI (/judge)

- 화면의 입력은 **성향 칩 3개**(단일 선택, 선택하면 검정 면)뿐이고 버튼은 **"<성향> 심사위원 생성"**, **"3명 한 번에 생성"**입니다.
- 화질(빠름/보통/고화질)은 성향이 아닌 기술 옵션이라 하단 접힘 패널 **"개발용 옵션 · 화질 · 오류 미리보기"**로 옮겼습니다. 기본값은 빠름(low)입니다.
- 갤러리는 모바일 2열, 태블릿 이상 3열이고 데스크톱에서는 왼쪽 컨트롤과 오른쪽 갤러리 2열 구성입니다. 사진은 **항상 컬러**로 생성·표시합니다(2026-11-12 사용자 결정: DESIGN.md의 흑백 얼굴 지침을 심사위원 사진에는 적용하지 않음). 프롬프트에 컬러를 명시합니다.
- 카드에는 사진, 성(姓) 포함 이름, 성향 태그, `50대 · 남성 · 56세`, 생성 지연과 화질, "다시 생성", 삭제가 있습니다. 사진을 누르면 상세 시트가 열립니다(모바일은 하단 시트, 데스크톱은 모달). 상세 시트에는 TTS 힌트, 모델 메타, 랜덤 요소와 **생성 프롬프트**(접힘)가 있습니다.
- 생성 중에는 스켈레톤 카드와 경과 초를 보여 주고, 다시 생성할 때는 해당 카드와 **상세 시트의 사진 모두에** 스피너·경과 초 오버레이를 띄웁니다. 그동안 카드와 상세 시트의 "다시 생성"·삭제 버튼은 비활성화되고, 같은 심사위원에 대한 중복 요청은 클라이언트에서 막습니다(ref 가드). 완료되면 상세 시트가 새 인물로 바뀝니다.
- 패널 스트림이 어떤 슬롯의 결과 없이 끝나면(서버 크래시 등) 남은 스켈레톤은 오류 카드로 바뀝니다.
- 카드 사진은 `srcset`으로 256/512px 변형을 받습니다(모바일 DPR 2–3에서 512px). 오류가 나면 오류 카드(빨간 텍스트, 아이콘, 힌트, 다시 시도, 닫기)를 보여 줍니다. 결과는 `aria-live`로 알립니다.

## Verification evidence

- **실제 호출 curl 생성 12명 이상**
  - 1차 6명: 개별 POST 병렬. 10.7–17.5s.
  - 2차 6명: `/panel` 스트림 2회. 3명 병렬 11.4s와 11.8s.
  - 3차 6명: 최종 프롬프트, 개별 POST(low 5명 + medium 1명). low 7.9–17.3s, medium 29.3s.
  - 콘택트 시트: `.verify/judge/round1.jpg`, `round2.jpg`, `round3.jpg`
- **육안 검수**
  - 모든 이미지가 자연광 실사였고, 텍스트·워터마크·테두리가 없었고, 프레이밍이 일관됐습니다.
  - 3차는 남3/여3, 30–60대였고 표현된 나이가 지정 나이와 일치했습니다.
  - 표정이 성향과 맞았습니다. 친절함=미소, 빡셈=무표정, 공격적=강한 시선이었습니다.
- **프롬프트 반복 개선**
  - 1차: 인물이 지정 나이보다 늙어 보였습니다 → "fine lines"를 제거하고 "should look genuinely N years old"를 넣었습니다.
  - 2차: "한쪽 눈썹 올림" 변형에서 한쪽 눈만 찡그린 결과가 나왔습니다(`.verify/judge/full-j_mwdjbdb9yycbs.jpg`) → 그 변형을 제거하고 "both eyes open, natural and symmetrical"을 추가했습니다.
  - 3차에서 두 문제 모두 해결된 것을 확인했습니다.
- **API 검사**
  - 이미지: `200 image/webp`, `cache-control: public, max-age=31536000, immutable`, ETag 재요청 → `304`.
  - 썸네일: 256px, 5.4KB.
  - 잘못된 id(`..%2F..`)와 없는 id는 404.
  - 잘못된 temperament는 400, simulateError는 422/429.
  - `/panel` 시뮬레이션 오류도 슬롯별 error 이벤트로 왔습니다.
- **헤드리스 UI** `node judge/tests/ui.mjs --live`: 19/19 PASS
  - 모바일 390×844와 데스크톱 1280×860: 목록 로드, 컬러 표시, 가로 스크롤 없음, 상세와 프롬프트 펼침, Esc로 닫기, 오류 카드(moderation, rate_limit), 콘솔 에러 0.
  - live: 3명 생성 +3장, 오류 0, 12.3s / 단일(빡셈) 9.8s / 다시 생성이 제자리에서 교체됨 / 삭제.
- **스크린샷** `.verify/judge/`
  - `ui-mobile.png`, `ui-mobile-color.png`, `ui-mobile-detail.png`, `ui-mobile-errors.png`
  - `ui-mobile-panel-loading.png`, `ui-mobile-panel-done.png`, `ui-mobile-regenerating.png`
  - `ui-desktop.png`, `ui-desktop-detail.png`, `ui-desktop-full.png`
- **정적 검사**: `tsc --noEmit`(judge 파일)과 `eslint judge app/judge app/api/judge` 모두 클린.

### 리뷰 1차 수정 검증 (2026-11-12)

| 리뷰 이슈 | 수정 | 검증 |
|---|---|---|
| (major) 상세 시트 재생성에 진행 표시가 없고, 두 번 누르면 심사위원이 중복 생성됨 | `JudgeDetail`에 `busy` 전달 → 사진 오버레이(스피너, 경과 초, ETA), 재생성·삭제 버튼 비활성화. `JudgeStudio`에 `inflight` ref 가드를 둬서 같은 id에 대한 재생성과 삭제를 동기적으로 거부 | `node judge/tests/fixes.mjs`: 탭 1회 후 150ms 만에 `regenDisabled/delDisabled/overlay=true`. 실제 탭, 강제 JS click, 삭제, 카드 버튼까지 **4회 시도에도 POST 1회**. 카드 수 36→36, 13.7s 뒤 상세 시트가 새 인물로 바뀜. 스크린샷 `.verify/judge/fix1/m-detail-regenerating.png`, `m-detail-after-regen.png` |
| (minor) `null` body가 500 | `readJson`이 객체가 아니면 `bad_request`를 던짐 | curl: `null`, `[]`, `"x"` → `/api/judge`와 `/api/judge/panel` 모두 400 |
| (minor) 패널 성씨 중복 | `RollAvoid.surnames`를 추가하고 `startPanel`이 사용 | 시뮬레이션 1000패널에서 16.8%→0%. 실제 패널 2회: 김윤희·유민재·신경아 / 오상우·서형준·김정호 |
| (minor) 한쪽 눈 찡그림 결함 이미지가 갤러리에 남아 있음 | `j_mwdjbdb9yycbs.*`를 `.data/judge/_rejected/`로 옮김(목록에서 제외, 증거는 보존) | `GET /api/judge/j_mwdjbdb9yycbs` → 404 |
| (minor) 카드가 1024px 원본을 로드 | `?size=card`(512px) 변형 + `srcset`/`sizes` | 모바일 36장 로드: **card 499KB, full 0KB**(이전에는 원본 합계 2.9MB). 데스크톱(DPR1)은 thumb 256px를 고름 |
| (minor) 화질 선택이 두 번째 입력처럼 보임 | 하단 접힘 "개발용 옵션"으로 이동 | 보이는 radiogroup은 `["심사위원 성향"]` 하나뿐. `.verify/judge/fix1/m-top.png`, `m-dev-options.png` |
| (minor) 패널 스트림이 결과 없이 끝나면 스켈레톤이 무한 대기 | `streamPanel` 완료 후 아직 pending인 슬롯을 `server` 오류로 바꿈 | 요청 가로채기로 `start` 줄만 보내는 가짜 스트림 → 1.2s 안에 스켈레톤 0, 오류 카드 3(`server`). `.verify/judge/fix1/m-panel-truncated.png` |
| (minor) README의 요청 중단 설명이 틀림 | 아래 Known limitations를 고침 | — |

`node judge/tests/fixes.mjs` **11/11 PASS**(콘솔 에러 0), 기존 `node judge/tests/ui.mjs` **15/15 PASS**.

## HIL test checklist (사람이 해 볼 것)

1. http://localhost:3100/judge 를 휴대폰 크기와 데스크톱 크기로 각각 열어 보세요. 기존에 생성된 심사위원이 컬러로 보여야 합니다.
2. 성향을 고르고 "생성"을 눌러 보세요. 스켈레톤에 초가 올라가고 약 10초 뒤 카드가 생겨야 합니다. 같은 성향으로 여러 번 생성해 성별, 나이, 이름, 복장, 배경이 매번 달라지는지 보세요.
3. "3명 한 번에 생성"을 눌러 보세요. 세 카드가 각각 따로 완성되고, 성과 이름이 겹치지 않고 성별·나이가 섞였는지 확인하세요.
4. **실사 품질**: 컬러 토글을 켜고 상세 시트에서 큰 사진을 보세요. AI 티(손, 귀, 눈 비대칭, 글자)나 어색한 점이 있는지 봅니다.
5. **성향 표현**: 친절함, 빡셈, 공격적이 얼굴만 보고 구분되는지 보세요. 공격적이 과하지 않은지(DESIGN 의도)도 함께 봅니다. 너무 약하거나 강하면 피드백해 주세요.
6. 하단 "개발용 옵션"을 펼쳐 화질 "보통/고화질"로 하나씩 생성해 보고 low와 비교해 볼 만한 차이가 있는지 보세요(약 30초, 약 90초).
7. 카드의 "다시 생성"과 상세 시트의 "같은 성향으로 다시 생성"은 같은 성향의 새 인물로 제자리에서 바뀌어야 합니다. 상세 시트에서는 진행 오버레이와 경과 초가 보이고 버튼이 잠겨야 하며, 여러 번 눌러도 카드 수가 늘지 않아야 합니다. 삭제한 카드는 새로고침 후에도 없어야 합니다.
8. 하단 "오류 화면 미리보기"에서 moderation과 rate_limit을 눌러 오류 카드 문구가 자연스러운지 보세요.
9. 상세 시트의 "생성 프롬프트"를 펼쳐 프롬프트를 확인하세요. "TTS 힌트"가 사진과 어울리는지도 보세요.

## Known limitations

- 실제 moderation 차단과 rate limit은 재현하지 못해 시뮬레이션으로만 UI를 검증했습니다. 분류 로직은 OpenAI `APIError`의 status와 code를 기준으로 합니다.
- 저장소는 로컬 파일(`.data/judge`)입니다. 인증과 사용자 분리가 없고 갤러리는 전체 공유입니다. 실제 앱에서는 SQLite/스토리지로 옮겨야 합니다.
- 같은 사람을 다시 만들 수 없습니다(seed 없음). 대신 `traits`와 `prompt`를 저장하므로 비슷한 사람을 재생성할 수는 있습니다.
- 이미지 생성은 동기 HTTP 요청(약 10초)입니다. 요청의 `req.signal`을 OpenAI 호출에 넘기므로, 클라이언트가 끊으면(탭 닫기, 새로고침) **생성이 취소되고 아무것도 저장되지 않습니다**. 비용도 낭비하지 않습니다. 반대로 끊긴 뒤에도 결과를 얻고 싶다면 실제 앱에서는 작업 큐로 바꿔야 합니다.
- 중복 재생성 가드는 클라이언트(탭 하나) 기준입니다. 서로 다른 탭이나 기기에서 같은 심사위원을 동시에 재생성하면 둘 다 생성되고, 늦게 끝난 쪽은 새 카드로 추가됩니다(서버에 락 없음).
- 첫 실사 검수 때 결함이 있던 이미지 1장은 `.data/judge/_rejected/`에 보관했습니다(목록에서 제외).
- 성향에 따른 표정 차이는 일부러 미묘하게 두었습니다(DESIGN.md). 공격적과 빡셈은 사진만으로 구분이 애매할 수 있어 UI에 반드시 텍스트 태그를 붙입니다.
- 이름은 세대별 이름 풀에서 고르며, 패널 안에서만 중복을 막습니다(전체 갤러리에서는 중복될 수 있음).

## Next steps

- 실제 앱의 상황 설정 화면에서는 심사위원 카드의 성향 칩을 바꾸면 `POST /api/judge {replaceId}`로 다시 생성하고, 발표를 시작하기 전에 `startPanel`로 미리 만들어 둡니다(약 12초).
- 원형 썸네일에는 `?size=thumb`(256px), 카드에는 `?size=card`(512px)를 사용합니다. 발표 화면처럼 작은 얼굴은 썸네일만으로 충분합니다.
- 오류가 나면 서버에서 자동으로 한 번 더 roll해서 재시도합니다(moderation이면 다른 traits로).
- stt-tts PoC의 음성 선택표에 `gender`, `age`, `temperament`를 연결합니다(`voiceHint` 참고).
- 생성 대기 시간을 줄이려고 `partial_images` 스트리밍(흐릿한 미리보기)을 검토합니다.
