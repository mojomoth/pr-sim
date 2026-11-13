# UI PoC — DANSANG 7개 화면 (`pocs/ui`)

`docs/screens/draft`의 시안 7종(01–07 PNG + `DESIGN.md` + `prompts.json`)을 Next.js 16 App Router 화면으로 구현한 프런트엔드 PoC다.
AI 호출 없이 **목업 데이터 + 실제 상호작용**(타이머, PDF 업로드/렌더, 카메라·마이크, 스와이프, 필터, 단계 전환)으로 전체 흐름을 클릭해 볼 수 있다.

- 진입: <http://localhost:3100/ui/screens> (리뷰어용 인덱스: 시안 썸네일 ↔ 구현 링크)
- 흐름: 랜딩 → 상황 설정 → 발표 → 심사 → 종합 결과 → 상세 피드백 → 목록 (기록 버튼 → 목록, 다시 시작/새 시뮬레이션 → 설정)

## 라우트

| # | 경로 | 화면 | 핵심 상호작용 |
|---|---|---|---|
| 01 | `/ui` | 랜딩 | 시작하기 → 설정, 연습 기록 → 목록 (※ 22:40 이후 다른 작업자가 `ui/screens/Landing.tsx`·`landing.css`·`public/landing/*`로 새 풀블리드 디자인을 적용 — fix:ui는 덮어쓰지 않음) |
| 02 | `/ui/setup` | 상황 설정 | 여러 줄 상황, 슬라이더 2개(발표 1–30분 기본 5, 질의응답 1–20분 기본 3, −/+ 버튼·키보드), PDF 업로드 2개(빈/업로드 중/완료(파일명·페이지 수·교체·삭제)/실패(재시도·닫기), 교체 실패 시 기존 파일 행 유지 + “교체 실패 · 기존 파일을 계속 사용해요”), 샘플 자료 사용, 심사위원 추가/삭제 + 성향 단일 선택, 실시간 “총 N분 · 심사위원 M명”, 필수값 없으면 CTA 비활성 + 사유 |
| 03 | `/ui/presentation` | 발표 | 단계명+타이머 상단 고정(sticky), mm:ss 카운트다운 + 진행바(30초 미만 빨강 + “곧 종료” 텍스트), 0초 → 전환 안내 다이얼로그 후 4초 뒤 심사로 자동 이동, PDF 슬라이드(이전/다음·스와이프·←/→·“3 / 12”·크게 보기, 세로 PDF는 높이 상한 안에 contain 맞춤), 내 카메라(getUserMedia, 거부 시 안내+다시 시도), 마이크 레벨 파형, 문장별 목업 전사(“음성 인식 중”→“인식 완료”), 심사위원 3명 “이름 · 성향”, 마이크/카메라 토글, 종료·뒤로 가기 모두 확인 다이얼로그(진행 중 + 남은 시간 저장) |
| 04 | `/ui/review` | 심사 / 질의응답 | 상단 고정 타이머, 종료·뒤로 가기 확인, 큰 심사위원 사진 + 배지 + “질문 중” 필, 질문(회색 surface) 타이핑 → 답변(검정 ink) 전사, “답변 완료”로 다음 심사위원·질문 순환(질문 수 = max(4, 심사위원 수) → 5명이면 5개, 모두 최소 1회 질문), 마지막 → 결과 |
| 05 | `/ui/results` | 종합 결과 | 82/100(80px), 영역별 3점수, 잘한 점/다음 연습에서는, 설정값 반영 메타 |
| 06 | `/ui/feedback` | 상세 피드백 | 탭(질문별 피드백 / 발표 분석, 화살표 키), 질문 카드(심사위원 아바타), 1/4 페이저, “이렇게 답해 보세요” |
| 07 | `/ui/history` | 목록 | 필터 전체/완료/진행 중(동작), 카드(날짜·배지·점수·결과 보기/다시 시작하기/이어하기 + “발표 06:12 남음”), 결과 보기 = 그 기록의 점수·제목·시간, 이어하기 = 그 기록의 설정 + 멈춘 단계·남은 시간에서 재개, 방금 진행한 기록 자동 추가, 고정 “+ 새 시뮬레이션” |
| – | `/ui/screens` | 인덱스 | 7개 화면 + 시안 썸네일, “발표 12초 버전”(`?sec=12`), “질의응답 40초 버전” |
| API | `GET /api/ui/fixture?slot=presentation\|proposal[&check=1]` | 샘플 PDF | `pocs/fixtures/**`의 `presentation.pdf`/`proposal.pdf`를 읽기 전용으로 제공(`check=1`은 존재 여부 JSON) |

HIL 팁: `/ui/presentation?sec=N`, `/ui/review?sec=N`으로 남은 시간을 N초로 줄여 자동 전환을 바로 확인할 수 있다.

## 아키텍처 & 데이터 흐름

```
app/ui/**/page.tsx (얇은 라우트, metadata만) ──► ui/screens/*.tsx (화면)
                                                  ├─ ui/components/* (공용 프리미티브)
                                                  └─ ui/lib/*        (상태·목업·훅)
app/api/ui/fixture/route.ts ──► ui/lib/fixture.ts (server-only, fixtures/ 탐색)
```

- **상태**: `ui/lib/store.ts` — `useSyncExternalStore` 기반 클라이언트 스토어. 직렬화 가능한 설정(상황·시간·심사위원·파일 메타·lastRun·`resume`(이어하기 지점: 단계+남은 초)·`viewRecord`(목록에서 고른 결과))은 `sessionStorage`에 저장(새로고침 유지), 업로드한 PDF `Blob`은 모듈 Map에 보관(클라이언트 내비게이션 동안 유지). SSR/하이드레이션은 `DEFAULT_STATE`를 써서 불일치가 없다.
- **PDF**: `ui/lib/pdf.ts` — `pdfjs-dist` v6를 동적 import(SSR 제외), 워커는 `public/ui/pdf.worker.min.mjs`. 업로드 시 클라이언트에서 페이지 수를 읽고, 발표 화면은 업로드/샘플 PDF Blob → `fixtures/presentation.pdf` → 목업 HTML 슬라이드 순으로 해석해 캔버스에 렌더(devicePixelRatio ≤2, ResizeObserver). 페이지는 “너비 × 최대 높이” 안에 contain 맞춤 — 최대 높이는 CSS 변수 `--slide-max-h`(모바일 `min(360px, 100dvh-400px)`, 데스크톱 `max(240px, 100dvh-360px)`, 크게 보기 `100dvh-140px`)로 화면이 정하고 `PdfPage`가 계산된 `max-height`를 읽는다. 세로(A4) PDF도 이전/다음·카운터가 고정 하단바 위에 남는다. 페이지 전환 중인 렌더는 취소(`RenderTask.cancel`).
- **미디어**: `ui/lib/useMedia.ts` — `useCamera`(권한 거부/장치 없음 분류 + retry), `useMicLevel`(AnalyserNode RMS → 파형).
- **목업 STT**: `ui/lib/useMockStt.ts` — 문장 단위 partial/final 상태(실제 앱에서는 stt-tts PoC 스트림으로 교체, 동일 형태).
- **타이머**: `ui/lib/useCountdown.ts` — 벽시계 기반(탭 스로틀링에 강함), `onEnd` 1회 호출, `?sec=` 오버라이드, `initial`(이어하기 남은 초). 발표/질의응답 화면은 단계명+타이머 블록을 `sticky top-0`으로 고정(DESIGN.md “단계 이름과 남은 시간을 상단에 고정”).
- **세션 이탈**: 헤더 “종료”와 뒤로 가기 chevron 모두 `ExitDialog`(계속하기/종료하기·나가기) → 진행 중 기록에 단계·남은 초 저장 → 목록 “이어하기”가 그 지점에서 재개.
- **모달**: `Dialog`/전체화면 슬라이드는 `document.body` 포털(페이지 전환 애니메이션의 transform 컨테이너에 갇히지 않도록).
- 디자인 토큰은 공유 `app/globals.css`(bg-canvas/surface/card, text-ink/secondary, border-line, text-error, `.tabular`)만 사용. UI 전용 모션·range 스타일은 `ui/ui.css`(`app/ui/layout.tsx`에서 import).

## 사용 모델 (이미지 생성만, 1회성)

`ui/scripts/gen-images.mjs` → OpenAI **gpt-image-2** (quality high, jpeg 82). 화면은 런타임에 AI를 호출하지 않는다.

| 파일 | 크기 | 내용 | 생성 시간 |
|---|---|---|---|
| `public/ui/hero-stage.jpg` | 1536×1024 | 흑백 빈 발표 무대(연단 마이크·프로젝션 스크린, 인물·텍스트 없음) | 61.6s / 119KB |
| `public/ui/judge-minseo.jpg` | 1024² | 민서 · 친절함 (40대 여성, 단발) | 90.5s / 95KB |
| `public/ui/judge-junho.jpg` | 1024² | 준호 · 빡셈 (50대 남성, 둥근 안경) | 88.4s / 111KB |
| `public/ui/judge-doyun.jpg` | 1024² | 도윤 · 공격적 (40대 남성, 짧은 머리) | 91.1s / 91KB |
| `public/ui/presenter.jpg` | 1024×1536 | 발표자 웹캠 플레이스홀더(예비) | 65.6s / 91KB |

5장 병렬 생성(총 ~91s). 얼굴·카메라·슬라이드는 갱신된 DESIGN.md(“UI와 콘텐츠의 색상 범위”)에 따라 **컬러**로 표시(필터 없음), 흑백은 UI 요소와 랜딩 배경에만. 모두 가상 인물. 왜 gpt-image-2: 브리프 지정 + 심사위원 생성 PoC와 같은 모델로 톤을 맞추기 위함.

## 재사용 가능한 lib/컴포넌트 API (실제 앱용)

```ts
// components
<Button href? onClick? variant="primary|secondary|outline" size="lg|md|sm" arrow disabled />   // 56px/r20 검정 CTA
<TextLink href /> <BottomBar wide? desktopHidden? line?>…</BottomBar>                            // 고정 하단 액션 + safe-area
<Brand href?|null size? /> <BrandHeader right? backHref? /> <StepHeader title backHref? onBack? right? /> <HeaderPill href|onClick outline? />  // 확정 BI 로크업; StepHeader = 로고 행 + 단계 행 (onBack이면 로고 비링크)
<Chip selected onSurface? /> <ChipGroup options value onChange label /> <PersonaChips value onChange name /> <Badge tone />
<MinuteSlider label min max value onChange />                                                    // range + −/+
<UploadRow label required? value?:FileMeta onUploaded(meta, blob) onRemove onSample? />           // 4가지 상태
<JudgeRow judge onChange onRemove /> <JudgeTile judge /> <JudgeHero judge speaking /> <JudgeAvatar judge size secondary? />  // 얼굴은 항상 eager, 보조 아바타는 fetchPriority=low
<Bubble tone="surface|ink" label? status? live? /> <Caret /> <Waveform bars level? active? />
<Timer label remaining total warnAt? />                                                          // 30초 미만 빨강 + 텍스트
<SlideStage src={useDeck()} page onPage overlay? /> <MockSlide index />
<CameraView stream status variant="inset|panel" /> <PermissionNotice kind onRetry />
<Dialog open onClose title /> <ExitDialog open onClose phase remainingSec to? title? confirmLabel? /> <PhaseEndDialog open title body nextLabel href seconds? />
<Screen width="narrow|wide" bottomPad /> <MediaToggle kind on onToggle />
// lib
useUiState(), setUiState(patch), resetSetup(), setFileBlob/getFileBlob(slot)        // store.ts
openPdf(blob|url), countPages(blob), renderPage(doc, n, canvas, cssWidth, maxCssHeight?, onTask?)  // pdf.ts (contain 맞춤)
useCountdown(totalSec, {running, onEnd, initial}), mmss(sec), useSecondsOverride()  // useCountdown.ts
useCamera(enabled) → {status, stream, retry}, useMicLevel(enabled) → {level, status, retry}
useMockStt(sentences, running) → {finals, partial, status}
buildQuestions(judges) → QAItem[], questionCount(n) = max(4, n) (공유 lib/types.ts 계약 사용)
```

공유 계약 `lib/types.ts`의 `JudgePersona`/`Temperament`/`QAItem`를 그대로 확장(`UiJudge extends JudgePersona { role? }`)해 judge·question PoC 결과를 바로 꽂을 수 있다.

## 접근성 · 반응형

- 포커스: 전역 `:focus-visible`(검정 2px + 흰 간격), range는 thumb 링. 아이콘 버튼 전부 `aria-label`, 토글은 `aria-pressed`, 칩은 `radiogroup`/`radio` + 화살표 키, 탭은 `tablist`/`tab` + 화살표 키.
- 타이머 숫자는 `aria-hidden`, 스크린리더에는 1분/30초/종료 마일스톤만 `aria-live=polite`. 전사·답변 말풍선은 `aria-live`.
- 상태는 색 + 문구(업로드 실패, “곧 종료”, “마이크 꺼짐”…). `prefers-reduced-motion`에서 모든 전환/파형/캐럿 애니메이션 제거.
- 고정 하단바에 가려지지 않도록 `scroll-padding-bottom: 180px`.
- 모바일 단일 열(390 기준, 24px 거터/≤360은 20px). 데스크톱(≥1024): 최대 1120px, 설정 = 폼 | 요약(시작 버튼 포함) 2열, 발표 = PDF | 카메라·전사·심사위원 2열, 심사 = 얼굴 | 대화 2열, 목록 = 요약·필터 | 리스트.

## HIL 체크리스트 (사람이 직접 해 볼 것)

0. 모든 화면 왼쪽 위 로고가 확정 BI(검정 D 심볼 + DANSANG, `assets/bi/lockup-black.png`)인지, 파랑/시안 STAGE 로고가 남아 있지 않은지. 심사위원 얼굴이 컬러인지.
1. `/ui/screens`에서 각 화면을 열어 왼쪽 시안 썸네일과 간격·글자 크기·모서리·검정 CTA 인상이 맞는지 비교 (휴대폰 실기기 또는 DevTools 390×844).
2. `/ui` → 시작하기 → 설정: 슬라이더를 드래그/−/+/키보드로 바꾸면 하단 “총 N분”이 즉시 바뀌는지.
3. 발표 자료에 **내 PDF**를 올려 업로드 중 → 파일명·페이지 수가 맞는지, PDF가 아닌 파일을 올리면 “업로드 실패 · 다시 시도”(× 로 닫기)가 나오는지, 교체/삭제. 올린 뒤 “교체”로 .txt를 고르면 기존 파일 행이 그대로 보이고 그 아래 “교체 실패” 안내가 뜨는지.
4. 심사위원 추가(최대 5) → 새 심사위원은 이니셜 아바타, 삭제, 성향 칩이 한 명당 하나만 선택되는지. 발표 자료가 없으면 시작 버튼이 비활성 + 사유 표시.
5. 발표 화면: 브라우저 카메라 권한 허용 → 오른쪽 아래 내 얼굴(좌우 반전), 거부 → “카메라 권한이 필요해요 · 다시 시도”. 마이크에 말하면 파형이 움직이는지.
6. 슬라이드를 좌우 스와이프/버튼/←→로 넘기고, 크게 보기(Esc로 닫기).
7. `/ui/presentation?sec=35` → 30초 미만에서 타이머가 빨강 + “곧 종료”, 0초에 “발표 시간이 끝났어요” 안내 후 4초 뒤 심사로 이동.
8. 심사: 질문이 타이핑되는 동안 “질문 중”, 이어서 검정 답변 말풍선이 전사됨. 답변 완료를 눌러 4개 질문이 심사위원 순서대로 돌아가는지. 설정에서 심사위원을 5명으로 늘리면 “1 / 5”가 되고 5번째 심사위원도 질문하는지.
9. 결과 → 상세 피드백(탭·다음 질문) → 기록으로: 맨 위 “방금” 기록, 필터 동작, 다시 시작하기는 같은 조건으로 설정 화면, + 새 시뮬레이션은 초기화.
9-1. **세로 PDF**: 발표 자료에 `fixtures/proposal.pdf`(A4 58p) 같은 세로 문서를 올리고 발표 시작 → 슬라이드가 가운데 맞춤되고 이전/다음·“1 / 58”이 스크롤 없이 하단바 위에 보이는지, 아래로 스크롤해도 “발표 중”·남은 시간이 상단에 붙어 있는지.
9-2. **이탈/이어하기**: 발표 중 뒤로 가기(‹) → 확인 다이얼로그 → 나가기 → 목록 맨 위 “진행 중 · 발표 mm:ss 남음” → 이어하기가 그 시간부터 이어지는지. 목업 “프로젝트 최종 발표”(10분) 이어하기 → 06:12부터, 76점 카드 결과 보기 → 76점.
10. 데스크톱(≥1024px)에서 설정 2열·발표 2열이 과하게 늘어나지 않는지, 키보드 Tab만으로 전체 흐름을 진행할 수 있는지.
11. OS의 “동작 줄이기”를 켜고 애니메이션이 사라지는지.

## 검증 증거

명령(모두 `pocs/`에서 실행):

- `pnpm exec tsc --noEmit | grep -E '^(ui/|app/ui/|app/api/ui/)'` → 0건, `pnpm exec eslint ui app/ui app/api/ui` → 0건.
- `curl` 8개 라우트 전부 200 (첫 컴파일 이후 20–240ms). `curl '/api/ui/fixture?slot=presentation&check=1'` → `{"exists":true,"name":"presentation.pdf","size":219045}`.
- `node ui/tests/screens.mjs` → 16개 캡처(390×844 viewport·fullPage·스크롤 끝 + 1280×860), **가로 넘침 0, 콘솔 에러 0**. 결과: `.verify/ui/*.m.png`, `*.m.full.png`, `*.m.bottom.png`, `*.d.png`, 로그 `.verify/ui/screens.log`.
- `node ui/tests/flow.mjs` → **40/40 PASS** (로그 `.verify/ui/flow.log`, 상태 캡처 `.verify/ui/flow/*.png`): 업로드 실패/진행/완료(12페이지), 슬라이더 +/−·키보드, 심사위원 추가/삭제/성향, 타이머(06:00→05:58), 업로드 PDF 렌더, 버튼 3/12·스와이프 4/12, 카메라 스트림, 전사 상태 전환, 크게 보기, 마이크/카메라 토글, 4개 질문 순환, 결과 82 + 설정값 반영, 피드백 2/4·분석 탭, 목록 “방금”·필터(9 = 8 + 1)·다시 시작·새 시뮬레이션, 30초 미만 빨강, 0초 전환 안내 → 자동 이동, 종료 → 진행 중 저장, 권한 거부 안내, 콘솔 에러 0.
- 이미지 생성: `.verify/ui/gen-images.log`.

### 리뷰 1차 수정 검증 (fix:ui)

- `node ui/tests/fix-1.mjs` → **33/33 PASS** (로그 `.verify/ui/fix-1.log`, 캡처 `.verify/ui/fix/*.png`). 측정값:
  - 세로 PDF(proposal.pdf, A4 58p) 데스크톱 1280×860: 캔버스 353×500, 스테이지 하단 742 / 하단바 top 775, 다음 버튼 bottom 730 (수정 전: 스테이지 높이 916, bottom 1082). 모바일 390×844: 캔버스 254×360, 다음 버튼 586 / 하단바 703 (수정 전 스테이지 521px). 크게 보기 세로 페이지 bottom 778 / 860. 16:9 샘플은 그대로(모바일 318×178, 데스크톱 592×333).
  - 600px 스크롤 후 타이머 top=86 (발표 모바일·데스크톱, 질의응답 모바일 모두 상단 고정; 수정 전 −288/−245).
  - 뒤로 가기 → “발표를 멈추고 나갈까요?”/“질의응답을 멈추고 나갈까요?” → 계속하기는 화면 유지, 나가기 → `/ui/setup` + 목록 맨 위 “진행 중 · 발표 04:54 남음” / “질의응답 02:53 남음” → 이어하기 시 같은 시간에서 재개(“· 이어하기” 라벨).
  - 목업 진행 중 기록(10분) 이어하기 → 06:12, 76점 카드 결과 보기 → 총점 76 + “신규 서비스 투자 제안 · 2026.11.10 기록”.
  - 샘플 자료 사용 → `/api/ui/fixture?slot=presentation` 본문 요청 1회(이전 2회), 스테이지 라벨 “샘플 PDF”.
  - 7개 라우트 × 모바일·데스크톱 콘솔: error·warn 0 (LCP 경고 및 React SSR 이미지 preload 미사용 경고 포함, 라우트당 3.5s 대기).
  - 랜딩 사진 점: `rgb(17,17,17)`, box-shadow none, 14px.
- 회귀: `node ui/tests/flow.mjs` → 40/40 PASS, `node ui/tests/screens.mjs` → 16캡처 가로 넘침 0·콘솔 에러 0. `tsc`(내 파일) 0건, `eslint ui app/ui app/api/ui` 0건.

### 리뷰 2차 수정 검증 (fix:ui, round 2)

- 근거 문서 변경을 따라감: DESIGN.md 22:34(확정 BI 로고) → 22:40(컬러 미디어), 시안 PNG 22:38 재렌더(md5가 `archive/pre-approved-bi/`와 달라짐 확인).
- `python3 ui/scripts/prepare-brand.py` → `assets/bi/lockup-black.png`에서 `public/ui/brand/lockup-black.png`(비율 1056:144 유지) 생성. 헤더는 32px 높이(약 235×32) + 8px 상하 여백(≥ 심볼 너비 1/4). `bash ui/scripts/sync-drafts.sh` → `/ui/screens` 썸네일 7장을 새 시안으로 갱신.
- `node ui/tests/fix-r2.mjs` → **85/85 PASS** (결과 `.verify/ui/fix-r2/results.txt`, 캡처 `.verify/ui/fix-r2/*.png`):
  - 8개 라우트 × 모바일(390×844)·데스크톱(1280×860): 확정 로크업이 최상단(y ≤ 12) 왼쪽, 로드됨·비율 유지, 옛 `/brand/symbol.svg` 0건, `grayscale` 필터가 걸린 미디어 0건, 콘솔 에러 0. 단계 화면(발표·질의응답·결과·피드백)도 로고 행 + 단계 행 구조(시안 03–06과 동일).
  - 업로드: 빈 상태 실패 → × 닫기로 빈 상태 복귀, 유효 PDF 후 .txt 교체 → `presentation.pdf · 12페이지` 행 유지 + “교체 실패 · … 기존 파일을 계속 사용해요”, CTA 활성(보이는 상태와 일치), 닫기 후 파일 유지, 교체 실패 후 삭제 → 오류 없이 빈 상태 (`setup-bad-replace.png`).
  - 심사위원 5명: 페이저 “1 / 5”, 5번째 질문 = 지훈, 5명 모두 등장(모바일·데스크톱), 데스크톱 질문 순서 스트립 5칸 줄바꿈 (`d_review_5judges.png`, `m_review_q5.png`).
- 회귀: `node ui/tests/flow.mjs` → 40/40 PASS. `tsc`(내 파일) 0건, `eslint ui app/ui` 오류 0(경고는 외부에서 교체된 `Landing.tsx` 2건 + 리뷰어 테스트 1건).
- 랜딩 사진 점(minor): fix:ui가 흰 링을 추가했으나 직후 랜딩이 다른 작업자에 의해 점 없는 새 디자인으로 교체되어 해당 없음.

## 알려진 한계

- 점수·피드백·질문·전사는 모두 목업(시각 설계용). 실제 STT/질문/리포트는 stt-tts·question·report PoC 결과를 연결해야 한다.
- 업로드 PDF Blob은 메모리에만 있어 **새로고침하면** 발표 화면이 `fixtures/presentation.pdf`(없으면 목업 슬라이드)로 대체된다. 파일 메타는 sessionStorage에 남는다.
- 새로 추가한 심사위원은 얼굴 이미지가 없어 이니셜 아바타 (judge PoC의 `/api/judge/image/<id>` 연동 필요). 최대 인원 5명은 임시 상한.
- 목록 기록은 목업 8건 + 현재 탭의 마지막 실행 1건뿐(SQLite 저장은 실제 앱 단계).
- 목록의 “결과 보기”는 그 기록의 점수·제목·날짜·시간을 보여 주지만 잘한 점/개선점·상세 피드백 문구는 공용 목업이다(영역별 점수는 총점 차이만큼 이동한 예시값). 프로필 버튼은 동작 없음.
- 이어하기는 단계·남은 시간만 복원한다(슬라이드 위치·전사·답변 진행은 복원하지 않음). 브라우저 자체 뒤로 가기/새로고침/탭 닫기는 확인 다이얼로그 없이 이탈한다(헤더 ‹와 종료만 확인).
- 세로 PDF는 높이 상한에 맞춰 축소되므로 모바일에서는 글자가 작다 — 크게 보기(전체 화면)로 확인. 모바일에서는 카메라 인셋이 슬라이드 오른쪽 아래를 일부 가린다(시안 구성).
- 업로드 용량 제한 안내는 제품 정책 확정 전이라 표시하지 않음.
- 로고는 래스터 PNG(벡터 원본 없음, brand-identity.md). 3x 해상도로 준비해 레티나에서도 선명하지만 확대 시 SVG만큼 선명하지 않다.
- 랜딩(`/ui`)은 22:40 이후 외부 작업자의 새 디자인(`public/landing/*` 에셋, 별도 CSS)이며 이 PoC의 Tailwind 토큰/컴포넌트를 쓰지 않는다. 그 파일의 eslint 경고 2건은 손대지 않음.
- 진행 중 화면(발표·질의응답)은 로고 행이 추가되어 상단 고정 영역이 48px 늘었다(시안과 동일 구조). 작은 화면(높이 < 700)에서는 슬라이드 높이 상한이 그만큼 줄어든다.
- 헤드리스 검증은 Chrome 가짜 카메라/마이크 기준이며, Safari/iOS 실기기 카메라·자동재생 정책은 HIL에서 확인 필요.
- 개발 중 이슈: 새로 만든 `app/api/ui` 디렉터리를 dev 서버(Turbopack 워처)가 감지하지 못해 404 → 디렉터리 rename으로 재감지시켜 해결(서버 재시작 없음).

## 다음 단계

1. `useMockStt` → stt-tts PoC의 문장 단위 전사 훅으로 교체, 심사 질문 음성은 TTS로 재생하고 “질문 중” 필과 동기화.
2. 심사위원 행/타일을 judge PoC 생성 이미지와 연결(추가 시 얼굴 생성 + 로딩 상태).
3. `buildQuestions` → question PoC API, 결과/피드백 → report PoC 결과 스키마로 바인딩.
4. 스토어를 SQLite(`SessionRecord`) 영속화로 교체, 목록 실데이터·이어하기 지점 복원.
5. 슬라이드 뷰어를 slide PoC 컴포넌트와 통합(핀치 줌·썸네일), 업로드 PDF를 wiki PoC로 전송.
6. 실기기(iOS Safari/Android Chrome, Capacitor) 카메라 권한·safe-area 점검.
