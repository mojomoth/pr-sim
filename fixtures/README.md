# fixtures: 공용 테스트 데이터

다른 PoC(slide, wiki, stt-tts, judge, question, report, ui)가 함께 쓰는 **실전과 비슷한 테스트 데이터**입니다.
시나리오는 모든 파일에서 같습니다: **친환경 패키징 사업 제안**. (주)리웨이브가 해조류 부산물로 만든 생분해 완충재 **웨이브셀(WaveCell)**로 Pre-A 20억 원 투자를 요청합니다.

- 웹에서 보기: **http://localhost:3100/fixtures** (PDF·발표 대본·답변 텍스트 링크, 오디오 플레이어, 의도된 약점, 샘플 세션 미리보기)
- 정적 URL: `/fixtures/presentation.pdf`, `/fixtures/proposal.pdf`, `/fixtures/presentation-script.txt`, `/fixtures/sample-session.json`, `/fixtures/audio/*.wav`, `/fixtures/audio/answer-ko.txt`

## 파일 목록

| 파일 | 내용 | 수치 | 만든 방법 |
|---|---|---|---|
| `presentation.pdf` | 발표자료. 16:9 피치덱 | **12장**, 1280×720px(960×540pt), 추출 텍스트 2,693자 | `scripts/build-deck.mjs`: HTML/CSS와 인라인 SVG 차트를 puppeteer `page.pdf`로 출력. 흑백 + 강조색 #1F7A5C, Pretendard. `word-break: keep-all`로 한글 단어 중간 줄바꿈 방지 |
| `proposal.pdf` | 제안자료. A4 사업계획서 | **58쪽**(표지, 쪽 번호가 있는 목차, 14개 장), 추출 텍스트 100,846자 | `scripts/gen-proposal-text.mjs`로 장별 HTML 본문을 LLM 병렬 생성한 뒤 `scripts/build-proposal.mjs`로 조립하고 A4 PDF 출력(머리말·쪽 번호 포함). 목차 쪽 번호는 2패스 렌더로 채움. 본문에 생성 과정 메타 문구("팩트 시트" 등)가 있으면 빌드가 실패함 |
| `presentation-script.txt` | 덱에 맞춘 5분 발표 대본. 한 줄에 한 문장 | **54문장**, 2,220자, 필러 포함(음, 어, 그러니까) | 직접 작성. 숫자는 STT 출력처럼 아라비아 숫자로 표기 |
| `audio/speech-ko.wav` | 대본 앞 8문장의 한국어 음성. 앞 0.5초 무음, 문장 사이 0.8초 무음 | **57.1초**, PCM s16le 24kHz mono | `scripts/gen-audio.mjs --provider openai` |
| `audio/speech-ko-16k.wav` | 위 파일의 16kHz mono 버전. Chrome `--use-file-for-fake-audio-capture`용 | 57.1초 | ffmpeg로 리샘플 |
| `audio/speech-ko.timing.json` | speech-ko.wav 안에서 각 문장의 시작·끝(초)과 원문 | 8문장 | gen-audio.mjs |
| `audio/answer-ko.wav` | 질문 "원가가 기존 포장재보다 높은데 어떻게 경쟁하나요?"에 대한 답변 음성 | **17.2초**(앞 0.5초·뒤 0.8초 무음 포함), 24kHz mono | `gen-audio.mjs --provider openai --answer-only` |
| `audio/answer-ko-16k.wav` | 위 파일의 16kHz mono 버전 | 17.2초 | ffmpeg |
| `audio/answer-ko.txt` | 답변 음성의 질문과 정답 텍스트 | | gen-audio.mjs |
| `sample-session.json` | `SessionRecord`(lib/types.ts) 샘플 | 전사 **46문장**(0~269.4초, phase `presentation`), 심사위원 3명, QA 4개, 발표 5분 / 질의 3분 | `scripts/gen-session.mjs`(결정적, API 호출 없음) |
| `src/deck.html`, `src/proposal.html`, `src/proposal/ch01..14.html` | PDF의 원본 HTML(장별 LLM 출력 포함) | | 위 스크립트가 생성 |
| `lib/index.ts`, `lib/session.ts` | 재사용용 TS API. 경로·URL, zod 검증기, 의도된 약점 목록 | | |
| `components/FixturesPage.tsx` → `app/fixtures/page.tsx` | HIL용 열람 페이지 | | |

### 샘플 세션 구성
- 상황: 시드 이후 Pre-A(20억 원) 유치를 위한 VC 투자심사위원회 피칭. 5분 발표 후 3분 질의응답.
- 심사위원: 이정민(friendly, 여, 44), 박준호(strict, 남, 52), 최태성(aggressive, 남, 58). `imageUrl`은 비워 두었으므로 judge PoC가 채웁니다.
- 전사: 대본 54문장 중 8문장을 건너뛰어 시간에 쫓겨 생략한 상황을 흉내 냈습니다. 3문장에는 STT 동음이의 오류(완충재→완충제, 대체재→대체제)를 넣었습니다. 발표는 약 4분 30초에 끝나 5분 안에 들어옵니다.
- QA 4개
  1. 이정민(친절함): 재구매율 83%의 이유를 묻습니다. **좋은 답변**
  2. 박준호(빡셈): 덱의 118원과 제안서의 142원 차이를 지적합니다. **회피성 약한 답변**("기준이 좀 달라서요… 아마 초기 수치가…")
  3. 최태성(공격적): 원가가 높은데 어떻게 경쟁하는지 묻습니다. 답변은 `answer-ko.wav`와 같은 텍스트이며 일부만 답합니다.
  4. 박준호(빡셈): 2027년 32억의 생산능력 근거를 묻습니다. 그럴듯하지만 생산능력 계산은 하지 않는 답변입니다.
- `presentationDocId`/`proposalDocId`는 넣지 않았습니다(선택 필드). wiki PoC가 PDF를 인제스트한 뒤 채우면 됩니다.

## 의도된 약점 (judge/question/report 탐지 테스트용)

발표덱과 제안서는 하나의 팩트 시트(`scripts/facts.mjs`)에서 만들었습니다. **아래 항목만** 일부러 어긋나게 했습니다. 같은 목록이 코드에도 `INTENDED_WEAK_POINTS`로 들어 있습니다.

| # | 약점 | 발표덱 | 제안서 |
|---|---|---|---|
| 1 | **단위 원가 불일치** | 6장 비즈니스 모델, 9장: 세트당 원가 **118원**, 매출총이익률 **28%** | 9장 원가 구조(34쪽~)와 요약 등: 세트당 원가 **142원**(원료 18 + 전분 22 + 에너지 31 + 인건비 38 + 물류 19 + 감가 14), 매출총이익률 **약 14%** |
| 2 | **SOM 불일치** | 5장: SOM **340억 원**(SAM 6,800억의 5%) | 5장 시장 분석(17쪽~)과 요약: SOM **210억 원**(SAM의 약 3.1%) |
| 3 | **근거 없는 성장 가정 + 생산능력 미검증** | 9장: 2026E 2.7억 → **2027E 32억(약 12배)** → 2028E 96억 → 2029E 210억. 근거는 "LOI 3건 전환 + 월 신규 8곳"뿐 | 6장과 10장(38쪽~): CAC나 파이프라인 전환율 같은 정량 근거가 없고 확정적인 어조로 씁니다. 1공장 생산능력은 월 25만 세트(연 매출 약 5억 원 상당)이고 2공장은 2027년 3분기에 가동하므로 2027년 32억은 물리적으로 달성하기 어렵지만, 이 점을 검증하지 않습니다 |
| 4 | (보너스) **원료 단일 공급처** | 3장: 수산 부산물 원료를 강점으로만 제시 | 8장(30쪽~)과 11장(42쪽~): 수협 1곳과의 5년 MOU로 전량 조달하며 공급 리스크를 "낮음"으로 평가. 대체 공급처가 없습니다 |

그 밖의 수치(2공장 가동 2027년 3분기 및 2028년 목표 원가 92원, 택배 51억 개, 폐기물 31만 톤, 판매가 165원, 고객 12곳, 재구매율 83%, 누적 158만 세트, LOI 24억, 2026년 월별 출고, 팀, 로드맵, 투자 조건)는 덱과 제안서가 일치합니다.

## 아키텍처와 데이터 흐름

```
scripts/facts.mjs (팩트 시트, 덱/제안서 수치 차이 정의)
   ├─ build-deck.mjs ──────────────→ src/deck.html → presentation.pdf (puppeteer, 1280x720)
   ├─ chapters.mjs + gen-proposal-text.mjs (LLM 14개 장 병렬) → src/proposal/chNN.html
   │      └─ build-proposal.mjs ───→ src/proposal.html → proposal.pdf (A4, 머리말·쪽 번호)
presentation-script.txt ─ gen-audio.mjs (TTS, 문장별 생성 → PCM 이어 붙이고 WAV 헤더 → ffmpeg 16k) → audio/*
                        └ gen-session.mjs (결정적) → sample-session.json
sync-public.sh → public/fixtures/* (정적 서빙)   lib/index.ts → 서버 코드에서 경로·검증 재사용
```

## 사용 모델과 이유

- **제안서 본문: OpenAI `gpt-5.4-mini`**(Responses API, reasoning effort low). 14개 장을 병렬로 만들었고 장당 24~50초, 장당 약 4.9~9.5천 자, 출력 3.4~7.4k 토큰이 걸렸습니다.
  - 원래 계획은 Claude `claude-sonnet-5-5`였습니다. 하지만 **Claude 키가 사용 한도에 걸렸습니다**(400 "You have reached your specified API usage limits… regain access on 2026-12-01"). 이어서 시도한 Gemini `gemini-3.8-flash`는 Free Tier 키라서 STT/TTS PoC와 같은 쿼터를 나눠 써야 하므로 중단하고 OpenAI로 바꿨습니다.
  - Claude 경로(`--provider claude`, adaptive thinking, effort low, 스트리밍, `fallbacks: "default"`)와 Gemini 경로(`--provider gemini`)는 스크립트에 그대로 남아 있습니다.
- **음성: OpenAI `gpt-4o-mini-tts`**(voice `coral`, 발표자 톤 instructions, `response_format: "pcm"` 24kHz). 문장당 1.8~3.0초, 답변은 2.8초 걸렸습니다.
  - 원래 계획은 Gemini `gemini-3.8-flash-tts`였지만 **Free Tier 한도(모델당 하루 10회)를 다 써서** 429 오류가 났습니다(약 19시간 뒤 복구).
  - Gemini 경로(`--provider gemini`, voice `Kore`)는 그대로 있습니다. 이 TTS 모델은 `httpOptions: { apiVersion: "v1beta" }`가 있어야 동작하며, 기본 엔드포인트는 `speechConfig`를 거부합니다.
  - 쿼터 사고를 다시 막으려고 TTS 호출을 병렬에서 **순차**로 바꿨습니다.
- 덱과 세션 JSON은 API를 쓰지 않습니다(결정적).

## 재생성 방법 (pocs/에서)

```bash
node fixtures/scripts/build-deck.mjs                                                    # presentation.pdf
node --env-file=.env.local fixtures/scripts/gen-proposal-text.mjs --provider openai [--force] [ch05 ...]
node fixtures/scripts/build-proposal.mjs                                                # proposal.pdf
node --env-file=.env.local fixtures/scripts/gen-audio.mjs --provider openai [--answer-only]
node fixtures/scripts/gen-session.mjs                                                   # sample-session.json
bash fixtures/scripts/sync-public.sh                                                    # public/fixtures 반영
```

## 라우트와 재사용 API

- 페이지 `GET /fixtures`(서버 컴포넌트). 정적 파일은 `GET /fixtures/<file>`입니다(public/fixtures). API 라우트는 없습니다.
- `import { FIXTURES, fixturePath, readFixture, loadSampleSession, parseSessionRecord, SessionRecordSchema, INTENDED_WEAK_POINTS } from "@/fixtures/lib"`
  - `FIXTURES[key].url`: 브라우저용 URL. `fixturePath(key)`, `readFixture(key)`: 서버에서 디스크 경로와 Buffer를 얻습니다.
  - `loadSampleSession()`: 검증을 거친 `SessionRecord`를 돌려줍니다. `SessionRecordSchema`는 zod 스키마이며 `satisfies z.ZodType<SessionRecord>`로 lib/types.ts와 어긋나지 않게 tsc가 확인합니다.
- 브라우저 테스트에서 가짜 마이크로 쓰려면 `launch({ fakeAudioWav: "<abs>/fixtures/audio/speech-ko-16k.wav" })`를 씁니다. 문장별 정답은 `speech-ko.timing.json`에 있습니다.

## 검증 기록 (2026-11-12)

| 명령 | 결과 |
|---|---|
| `node fixtures/tests/check-pdfs.mjs` (unpdf) | presentation 12쪽, 960×540pt, 텍스트 2,698자(쪽당 최소 128자). proposal 58쪽, 596×842pt(A4), 텍스트 100,799자(쪽당 최소 140자). "118원"은 덱 6·9쪽, "340억"은 덱 5쪽에 있고 제안서에는 없음. "142원"과 "210억"은 제안서 여러 쪽에 있음 |
| 같은 스크립트로 확인한 제안서 장 시작 쪽 | 요약 p3, 회사 소개 p7, 문제 정의 p11, 솔루션 p14, 시장 p17, 고객·세일즈 p21, 경쟁 p25, 운영·생산 p30, 원가 p34, 재무 p38, 리스크 p42, 팀 p45, 일정 p49, 부록 p53 |
| `ffprobe` / `afinfo` | speech-ko.wav: pcm_s16le 24000Hz 1ch 57.10초. speech-ko-16k.wav: 16000Hz 1ch 57.10초. answer-ko.wav: 24000Hz 16.50초. answer-ko-16k.wav: 16000Hz 16.50초 |
| `node --env-file=.env.local fixtures/tests/check-audio.mjs` (gpt-4o-mini-transcribe로 왕복 확인) | 8문장 모두 정확히 전사됨. 오인식은 "완충재→완충제", "상자→3자", "처리비→설비비" 정도 |
| `node fixtures/tests/check-session.mjs` | `OK SessionRecord: 46 sentences (0–268.5s of 300s), judges 이정민/friendly, 박준호/strict, 최태성/aggressive, 4 QA` |
| `node fixtures/tests/page.mjs` (headless Chrome) | /fixtures를 모바일 390×844와 데스크톱에서 열었을 때 약 1.1초 안에 로드되고 콘솔 오류 0, 가로 넘침 없음. 정적 PDF, WAV, JSON 모두 200 |
| `pnpm exec tsc --noEmit` (fixtures 필터) / `pnpm exec eslint fixtures app/fixtures` | 오류 0 |
| 스크린샷 | `.verify/fixtures/deck-contact.png`(12장 컨택트시트), `presentation-p1.png`, `presentation-p9-09.png`, `proposal-p1.png`, `proposal-contact.png`(9쪽 샘플), `page-mobile.png`, `page-desktop.png` |

### 수정 라운드 1 (리뷰 지적 반영, 2026-11-12)

| 지적 | 조치 | 검증 |
|---|---|---|
| 제안서에 생성기 메타 문구 "팩트 시트" 노출(17·18·53·54쪽) | `src/proposal/ch05.html`, `ch14.html`의 4문장을 "당사 파일럿 실적", "출고 전표 기준 확정 실적" 등 실제 사업계획서 표현으로 교체. 근본 원인인 프롬프트에 메타 언급 금지 규칙 추가(`gen-proposal-text.mjs`). `build-proposal.mjs`에 가드 추가: `팩트 시트`/`fact sheet`/`프롬프트`가 본문에 있으면 빌드 실패 | `node fixtures/tests/review-grep.mjs "팩트 시트" "팩트"` 결과 0건. 교체 문구는 p18, p53, p54에서 확인 |
| 대본·답변·세션은 2공장 2028년 가동, 덱·제안서는 2027년 3분기 가동 | 덱 기준(2027 Q3 가동, 2028 목표 원가 92원)으로 통일. 대본 28행은 "내년 3분기에 완도 2공장이 가동되면, 2028년에는 원가를 92원까지…"로 바꿈. `gen-audio.mjs` ANSWER_TEXT와 `gen-session.mjs` QA 3도 같이 바꿈. answer-ko.wav는 OpenAI TTS 1회로 다시 만듦. speech-ko.wav는 앞 8문장만 쓰므로 바뀌지 않음 | `grep -n 2공장` 결과 "2028년에 2공장 가동"이 더 이상 없음. ffprobe: answer-ko.wav는 24kHz 1ch 17.2초, 16k 버전은 16kHz 17.2초. `check-audio.mjs` 왕복 전사는 "…내년 3분기에 이 공장이 가동되면 2028년에는 세트당 92원까지…"로 나옴. `check-session.mjs`는 OK(46문장, 0~269.4초) |
| /fixtures에 대본·답변 텍스트 링크 없음 | `FixturesPage.tsx`에 "발표 대본 TXT 열기" 카드와 `answer-ko.txt` 링크 추가 | `node fixtures/tests/page.mjs`: 모바일과 데스크톱 모두 href에 `/fixtures/presentation-script.txt`, `/fixtures/audio/answer-ko.txt`가 있음. 둘 다 200 text/plain UTF-8, 콘솔 오류 0, 가로 넘침 없음. 스크린샷 `.verify/fixtures/page-mobile.png` |
| 덱 한글 단어 중간 줄바꿈("비싸거/나", "프로젝/트") | 덱 body에 `word-break: keep-all; overflow-wrap: break-word` 추가. 같이 고친 것: 9장 차트의 "+31" 라벨이 막대 가장자리에 걸려 잘리던 문제(양수 영업이익 라벨을 막대 안 가운데로 옮김) | `.verify/fixtures/fix1/deck-02.png`, `deck-10.png`, `deck-09.png`, `deck-contact.png` |
| 제안서 목차에 쪽 번호 없음 | 2패스 렌더. 1패스에서 "00"을 자리표시자로 넣어 렌더한 뒤 unpdf로 장 제목이 있는 쪽을 찾고, 2패스에서 실제 쪽 번호를 넣음. 두 패스의 쪽수나 장 시작 쪽이 다르면 빌드 실패 | 빌드 출력 `58 pages; chapter starts 1:p3 2:p7 … 14:p53`. 이전 기록과 같음. `.verify/fixtures/fix1/proposal-toc-02.png` |
| 오디오가 Gemini TTS가 아닌 OpenAI TTS로 만들어짐 | **수정하지 않음**. Gemini Free Tier TTS 쿼터(하루 10회)를 STT/TTS PoC가 써야 하므로 확인 호출도 하지 않았습니다. 또 speech와 answer의 목소리를 맞추려고 answer 재생성에도 OpenAI(`coral`)를 썼습니다. 쿼터가 복구되면 `--provider gemini`로 전체를 다시 만들 수 있습니다 | 해당 없음 |

재검증으로 실행한 것: `check-pdfs.mjs`(덱 12쪽 2,693자, 제안서 58쪽 100,846자. 의도된 약점 키워드의 위치는 그대로), `tsc --noEmit`(fixtures 필터 결과 0건), `eslint fixtures app/fixtures`(오류 0), `sync-public.sh` 실행 후 `cmp`로 public 사본이 같은지 확인.

참고: 처음에는 덱에 `font-variant-numeric: tabular-nums`를 썼습니다. 이 경우 Pretendard의 tnum 글리프에 ToUnicode 매핑이 없어 **PDF에서 숫자가 추출되지 않았습니다**(예: "51억 개" → "억 개"). 이 스타일을 지워 해결했습니다. 앱에서 PDF를 만들 때도 같은 주의가 필요합니다.

## HIL 체크리스트

1. http://localhost:3100/fixtures 를 휴대폰 폭과 데스크톱에서 엽니다.
2. 발표자료 PDF를 엽니다. 12장 디자인이 실제 피치덱처럼 보이는지, 차트(시장 원, 월 출고 막대, 매출·영업이익)가 읽히는지 봅니다.
3. 제안서 PDF를 엽니다. 58쪽이 실제 사업계획서처럼 읽히는지, 표가 깨지지 않는지, 목차 쪽 번호가 실제 장 시작 쪽과 맞는지 봅니다. 9장 원가 구조(34쪽)에서 **142원**, 5장 시장(17쪽~)에서 **SOM 210억**을 찾아 덱과 비교합니다.
4. 두 오디오를 재생합니다. 발음과 속도가 발표처럼 자연스러운지, 숫자를 제대로 읽는지 들어 봅니다.
5. 샘플 세션의 전사와 QA가 그럴듯한지 봅니다. 특히 2번 답변이 "회피성"으로 느껴지는지 확인합니다.
6. 다른 PoC(question/report)가 이 세션과 PDF로 의도된 약점 1~3을 실제로 짚어 내는지 확인합니다.

## 알려진 한계

- **API 쿼터**
  - Claude 키는 2026-12-01까지 막혀 있어 Claude를 쓰는 모든 PoC에 영향이 있습니다.
  - Gemini 키는 Free Tier라서 gemini-3.8-flash-tts가 하루 10회로 제한됩니다. 이 에이전트가 쿼터를 확인하지 않은 채 병렬 8회를 호출하는 바람에 그날 TTS 쿼터를 다 썼습니다. 그래서 오디오는 Gemini가 아닌 OpenAI TTS로 만들었습니다. 쿼터가 돌아오면 `--provider gemini`로 다시 만들 수 있습니다.
- 대본 28행과 답변의 "내년"은 발표 시점(2026년 11월) 기준으로 2027년을 뜻합니다. STT나 질문 생성기가 상대 연도를 해석해야 덱과 맞춰 볼 수 있습니다.
- 제안서 본문은 LLM이 만들었기 때문에 장마다 표현이 조금씩 겹치고, 팩트 시트에 없는 세부 수치(예: 장별 채용 인원, 세부 KPI)는 장끼리 완전히 맞지 않을 수 있습니다. 핵심 수치와 의도된 약점은 grep으로 확인했습니다.
- 덱의 폰트는 jsDelivr CDN의 Pretendard를 받아서 씁니다. 오프라인이면 Apple SD Gothic Neo로 대체됩니다.
- 실존 기업과 기관 이름은 쓰지 않았습니다(A사, G사, E사 등으로 익명화). 이메일은 `ceo@rewave.example`(예약 도메인)입니다.

## 다음 단계

- 쿼터가 복구되면 Gemini TTS(`Kore`)로 음성을 다시 만들어 STT/TTS PoC와 같은 음색으로 맞춥니다. Claude로 제안서를 다시 만들어 문체 품질을 비교합니다.
- 회피성 답변, 모범 답변, 시간 초과 같은 세션 변형 픽스처를 더하면 report 점수가 얼마나 민감한지 테스트할 수 있습니다.
