# pocs/slide: Slide View PoC

> 요구사항(원문): "업로드한 PDF를 좌/우 로 스와이프 하여 보여질 수 있도록 프론트엔드"

- 웹 확인: **http://localhost:3100/slide**
  - 바로 열기: `/slide?sample=presentation` (12장 16:9 덱), `/slide?sample=proposal` (58쪽 A4)
  - 메인 스레드 렌더와 비교: `&main=1`
  - 임베드 확인: **http://localhost:3100/slide/embed** (기본값 그대로 뷰어 2개, 누른 뷰어만 키보드에 반응)
- 재사용 컴포넌트: `slide/components/SlideViewer.tsx`. 실제 앱의 발표 화면에 그대로 넣어 쓰는 것을 전제로 만들었습니다.
- 외부 AI API는 쓰지 않습니다. PDF 렌더링은 모두 브라우저에서 하고 서버에는 키가 필요하지 않습니다.

## 1. 구조와 데이터 흐름

```
[파일 입력 / 드래그&드롭 / 샘플 버튼]
        │ File            │ "/api/slide/sample/<name>" (URL, HTTP Range 지원)
        ▼                 ▼
 SlidePage (app/slide/page.tsx → slide/components/SlidePage.tsx)
        │  src
        ▼
 SlideViewer ──openPdf()──► pdfjs-dist v6 (dynamic import, 클라이언트 전용 청크)
   │                         ├─ 파싱 워커   /slide/pdfjs/pdf.worker.min.mjs
   │                         └─ 렌더 워커   /slide/pdfjs/pdf.renderer.min.mjs (OffscreenCanvas)
   │                            + cmaps / standard_fonts / wasm / iccs (정적 파일)
   ├─ 트랙: 현재 ±2 슬롯만 마운트, 캔버스 렌더는 현재 ±1만(현재 쪽을 먼저 그림)
   ├─ 제스처: Pointer Events → swipe.ts 순수 함수(러버밴드, 거리 또는 속도 판정)
   └─ 썸네일: IntersectionObserver로 보이는 것만, 직렬 큐로 렌더
```

| 파일 | 역할 |
|---|---|
| `slide/components/SlideViewer.tsx` | 재사용 뷰어: 스와이프, 키보드, 버튼, 썸네일, 전체 화면, 확대 |
| `slide/components/SlidePage.tsx` | `/slide` PoC 화면: 업로드, 드롭, 샘플, 측정값 패널 |
| `slide/components/EmbedDemo.tsx` | `/slide/embed`: 기본 props로 뷰어 2개를 넣은 임베드 확인 화면 |
| `slide/lib/pdf.ts` | pdf.js 로더와 워커 설정, `openPdf()`, 에러 문구, 업로드 검증 |
| `slide/lib/swipe.ts` | DOM 없는 제스처·레이아웃 계산(단위 테스트 대상) |
| `slide/lib/samples.ts` | (server-only) 샘플 PDF 응답, Range·ETag 지원 |
| `slide/scripts/sync-pdfjs.mjs` | pdf.js 런타임 자산을 `public/slide/pdfjs/`로 복사 |
| `app/slide/page.tsx`, `app/slide/embed/page.tsx`, `app/api/slide/sample/[name]/route.ts` | 얇은 라우트 파일 |
| `slide/tests/*` | 단위 테스트, E2E(headless Chrome), 스모크 |

### pdf.js 워커 설정 (Next 16 / Turbopack)
- 라이브러리 본체는 `import("pdfjs-dist")`로 불러옵니다. 이 동적 import는 `useEffect` 안에서만 실행되므로 SSR 경로에는 들어가지 않고 클라이언트 청크로만 번들됩니다.
- 워커, 렌더 워커, cmaps, 표준 폰트, wasm, ICC 파일은 **번들러를 거치지 않고** `public/slide/pdfjs/`에 정적 파일로 둡니다. 동일 출처에서 제공되며 `GlobalWorkerOptions.workerSrc`와 `rendererSrc`가 이 파일을 가리킵니다.
  - 이 방식은 Turbopack, webpack, `next build` 어디서나 똑같이 동작하고 postinstall 단계도 필요 없습니다.
  - pdfjs-dist를 업그레이드하면 `node slide/scripts/sync-pdfjs.mjs`를 다시 실행해야 합니다. 실행하지 않으면 pdf.js가 "API version does not match Worker version" 오류를 냅니다. 현재 버전은 `public/slide/pdfjs/version.json`(6.5.438)에 기록되어 있습니다.
- 검증 결과 "fake worker" 경고와 콘솔 에러가 0건이었습니다(E2E 검사 항목에 포함).
- v6에 새로 생긴 **렌더 워커**(`rendererSrc`)로 페이지를 OffscreenCanvas에서 래스터화합니다. 그만큼 스와이프 중 메인 스레드가 비어 있습니다. `disableWorkerRendering`을 켜면 메인 스레드에서 렌더하며, 측정값 패널의 체크박스로 둘을 비교할 수 있습니다.

## 2. 사용 모델
없습니다. 이 PoC는 순수 프론트엔드라서 Gemini, OpenAI, Claude를 호출하지 않습니다. 텍스트 추출과 위키 구성은 `pocs/wiki`가 맡습니다.

## 3. 라우트와 API

| 경로 | 설명 |
|---|---|
| `GET /slide` | PoC 화면. 쿼리: `sample=presentation\|proposal`, `main=1` |
| `GET /slide/embed` | 임베드 확인 화면(뷰어 2개, `keyboard="focus"` 기본값) |
| `GET\|HEAD /api/slide/sample/presentation` | `fixtures/presentation.pdf` (application/pdf) |
| `GET\|HEAD /api/slide/sample/proposal` | `fixtures/proposal.pdf` |
| 그 외 이름 | 404 JSON `{ error, available }` |

- `Range: bytes=a-b`, `bytes=-n` 요청에는 206과 `content-range`로 응답합니다. 범위를 벗어나면 416입니다.
- ETag가 같으면 304를 돌려줍니다.
- 정적 자산: `/slide/pdfjs/*`

## 4. 재사용 API (실제 앱용)

```tsx
import { SlideViewer, type SlideViewerHandle } from "@/slide/components/SlideViewer";

const viewer = useRef<SlideViewerHandle>(null);
<SlideViewer
  ref={viewer}                       // React 19: ref를 prop으로 전달
  src={file /* File | Blob | ArrayBuffer | Uint8Array | URL string */}
  initialPage={3}                    // 1부터 셈. src가 바뀔 때만 적용
  onPageChange={(page, total) => {}} // 1부터 셈. 로드 직후 한 번, 이후 쪽이 바뀔 때마다 호출
  className="..."                    // 바깥 카드(rounded-28 bg-card)에 추가할 클래스
  thumbnails                         // 기본값 true
  keyboard="focus"                   // 기본 "focus" | "global" | false (아래 설명)
  stageAspect="first"                // 기본 "first" | "current" | 숫자(가로/세로)
  disableWorkerRendering={false}
  label="발표 슬라이드"
  onLoad={({ numPages, loadMs, pageWidth, pageHeight }) => {}}
  onRender={({ page, ms, sinceOpenMs, workerRendering, outputScale, zoom }) => {}}
  onError={(message, err) => {}}     // 한국어 사용자용 문구
/>
viewer.current?.goTo(5); viewer.current?.next(); viewer.current?.prev(); viewer.current?.toggleFullscreen();
viewer.current?.focus();             // 키보드 포커스를 뷰어로 (파일·샘플 선택 직후 호출 권장)
```

- **키보드 범위**: 기본값 `"focus"`는 포커스가 뷰어 안에 있을 때만 키에 반응합니다. 슬라이드를 누르거나 탭하면 뷰어로 포커스가 옮겨집니다. 다른 컨트롤 옆이나 뷰어 여러 개와 함께 넣어도 안전합니다. `"global"`은 페이지 어디서든 반응하지만, 글자 입력 필드(text·textarea·select·radio·range 등)나 다른 뷰어 안에 포커스가 있으면 무시합니다. 체크박스·버튼형 input은 입력 필드로 보지 않으므로 ←/→가 동작합니다. `/slide` PoC 화면은 데모 편의를 위해 `"global"`을 씁니다. 버튼·체크박스에 포커스가 있을 때 Space는 그것을 누르는 브라우저 기본 동작을 유지합니다(키보드 사용자 접근성). 대신 뷰어 자체 컨트롤(이전·다음·전체 화면·썸네일)을 **마우스/터치로** 누르면 포커스가 뷰어로 돌아가 Space가 계속 "다음"을 뜻합니다(키보드로 누른 경우 `detail === 0`이라 포커스 유지). 뷰어 밖의 버튼(파일 선택, 처음으로/마지막으로, 렌더러 토글)을 누른 뒤에는 `focus()`를 호출하세요(PoC 화면이 그렇게 합니다).
- **무대 비율**: `"first"`(기본)는 1쪽 비율로 고정되어 넘기는 동안 높이가 변하지 않습니다. `"current"`는 현재 쪽 비율을 따라가므로 가로 덱에 섞인 세로 A4 쪽도 크게 보입니다. 대신 쪽마다 높이가 바뀝니다. `/slide` PoC 화면은 `"current"`를 씁니다.

- **높이**: `stageAspect`에 따른 비율로 정하고(기본은 첫 페이지), 최대 높이는 CSS 변수 `--slide-max-h`(기본 `min(68vh, 720px)`)입니다. 발표 화면에서는 `style={{ "--slide-max-h": "40vh" }}`처럼 부모가 조정하면 됩니다.
- **src 식별성**: `src`가 바뀌면(참조 기준) 문서를 다시 엽니다. `ArrayBuffer`를 넘길 때는 렌더마다 새 버퍼를 만들지 마세요. 내부에서 복사하므로 원본 버퍼가 detach되지는 않습니다.
- **DOM 훅**(테스트·통합용): 루트 `[data-state=loading|ready|error][data-page][data-total][data-zoom][data-fullscreen]`, `[data-page-indicator]`, `[data-action=prev|next|fullscreen]`, `[data-thumb=n]`, `[data-page-host=n][data-render-state]`
- **순수 함수**(`slide/lib/swipe.ts`): `rubberBand`, `dragOffset`, `decideRelease`, `VelocityTracker`, `fitContain`, `outputScale`, `clampPan`, `renderWindow`
- **로더**(`slide/lib/pdf.ts`): `loadPdfjs()`, `openPdf(src, { disableWorkerRendering, onProgress })`, `describePdfError`, `looksLikePdf`, `MAX_UPLOAD_BYTES`(100MB)

### 상호작용 명세
| 입력 | 동작 |
|---|---|
| 손가락·마우스 드래그 | 트랙이 포인터를 그대로 따라갑니다(`translate3d`, pointermove마다 React 렌더 없이 DOM에 직접 씀). 축 잠금 8px, 세로 제스처는 페이지 스크롤로 넘깁니다(`touch-action: pan-y`) |
| 놓을 때 | 이동 거리가 폭의 22% 이상이거나 속도가 0.45px/ms 이상이면(최소 12px) 쪽을 넘깁니다. 아니면 제자리로 스냅합니다. 한 번에 최대 1쪽 |
| 첫·마지막 쪽 | iOS식 러버밴드 저항(200px 당기면 약 82px 이동) 후 복귀 |
| 전환 | 200ms `cubic-bezier(.22,.8,.24,1)`. `prefers-reduced-motion`이면 전환 없음 |
| 키보드 | ←/→, PageUp/PageDown, Space(Shift+Space), Home/End, F(전체 화면), Esc. 입력 필드나 다른 뷰어에 포커스가 있으면 무시. 범위는 `keyboard` prop |
| 버튼 | 이전·다음 44px 검은 원형 버튼(끝에서는 비활성), "3 / 12" 표시(tabular, sr-only aria-live), 전체 화면 버튼 |
| 썸네일 | 가로 스트립에 현재 쪽 표시(검은 2px 링)와 자동 스크롤. 탭하면 해당 쪽으로 이동 |
| 확대 | 더블탭 2.5배 토글, 두 손가락 핀치 1~4배, 확대 중 한 손가락으로 이동(가장자리 제한). 확대가 멈추면 해당 배율로 다시 렌더해 선명하게 표시. 핀치 중에는 0.8배까지 줄어드는 시각 피드백이 있고, 손가락을 하나만 떼도(또는 둘 다 떼도) 1.05배 미만이면 즉시 1배로 복귀 |
| 트랙패드·휠 | 두 손가락 가로 스와이프(관성 포함) **한 번에 한 쪽**. 휠 이벤트가 200ms 끊기면 제스처 종료로 보고, 그 전까지는 첫 60px에서 한 쪽을 넘긴 뒤 나머지를 무시. 끊어서 여러 번 하면 그만큼 넘어감. `deltaMode`(줄·페이지 단위)도 px로 환산. 세로 휠은 가로채지 않음 |
| 전체 화면 | 지원하면 네이티브 Fullscreen API, 아니면 CSS 고정 오버레이(iPhone Safari). 배경은 검정, 컨트롤은 반전 |

### 렌더링과 메모리
- 캔버스 크기: CSS 크기 × `devicePixelRatio` × 확대 배율. 상한은 1,200만 픽셀로, iOS 캔버스 한도(1,670만) 아래입니다. DPR 변화(브라우저 확대, 모니터 이동)는 matchMedia로 감지합니다.
- 다시 렌더할 때는 새 캔버스를 투명하게 그린 뒤 교체합니다. 깜빡임이 없고 리사이즈와 회전은 160ms 디바운스로 처리합니다. 그 사이에는 기존 캔버스를 CSS로 늘려 보여 줍니다.
- 마운트는 현재 ±2 슬롯만 하고, 렌더는 현재 쪽을 먼저 그린 다음 ±1 쪽을 그립니다. 창 밖으로 나간 슬롯은 캔버스를 해제하고(`width=0`) `page.cleanup()`을 호출합니다. 문서를 바꾸거나 언마운트하면 `loadingTask.destroy()`를 호출합니다.
- 페이지마다 크기가 달라도 각 쪽의 원래 비율로 맞춥니다(가로 덱과 세로 A4 모두 확인). `stageAspect="current"`이면 무대도 현재 쪽 비율을 따릅니다.

## 5. HIL 체크리스트 (사람이 직접 해 볼 것)
1. 휴대폰(같은 Wi-Fi에서 `http://<맥 IP>:3100/slide`)이나 데스크톱에서 **샘플 발표자료**를 누르고 좌우로 스와이프해 보세요. 손가락을 따라오는지, 반쯤 넘기다 놓으면 되돌아오는지 확인합니다.
2. 짧고 빠르게 튕겨서(flick) 넘어가는지 봅니다. 1쪽에서 오른쪽으로, 12쪽에서 왼쪽으로 당겨 고무줄처럼 저항하는지 확인합니다.
3. 세로로 스크롤하다가 슬라이드 위를 지나가도 쪽이 넘어가지 않는지 확인합니다.
4. 키보드 ←/→/Home/End/F/Esc, 이전·다음 버튼, 썸네일 탭을 각각 써 봅니다.
5. 더블탭 확대와 핀치 확대를 해 보고, 확대 중 끌어서 이동한 뒤 글자가 선명해지는지 봅니다.
6. 전체 화면에서 스와이프한 뒤 닫아 봅니다. 휴대폰을 가로로 돌렸을 때 다시 선명하게 그려지는지도 봅니다.
7. **샘플 제안자료**(58쪽 A4)를 열어 첫 페이지가 바로 뜨는지, 빠르게 여러 장을 넘겨도 끊기지 않는지 확인합니다. 측정값 패널의 "첫 페이지 표시"를 봅니다. 같은 샘플 버튼을 다시 누르면 1쪽부터 다시 열리고 측정값이 새로 채워져야 합니다.
7-1. 데스크톱에서 샘플 버튼, "처음으로"/"마지막으로", 뷰어의 ‹ 버튼, 썸네일을 각각 클릭한 직후 Space를 눌러 보세요. 매번 다음 쪽으로 넘어가야 합니다(방금 누른 버튼이 다시 눌리면 안 됨).
7-2. Mac 트랙패드에서 두 손가락으로 가로 스와이프를 한 번 해 보세요. 관성까지 끝났을 때 정확히 한 쪽만 넘어가야 합니다. 빠르게 두 번 쓸면 두 쪽.
7-3. 휴대폰에서 1배 상태로 두 손가락을 오므렸다(축소) 한 손가락씩 떼 보세요. 슬라이드가 원래 크기로 돌아와야 합니다.
8. 내 PDF를 버튼으로 올리고, 끌어다 놓기로도 올려 봅니다. PDF가 아닌 파일, 깨진 PDF, 암호 PDF를 올리면 한국어 에러가 나오는지 확인합니다.
9. "메인 스레드로 렌더" 체크박스를 켜고 끄며 체감 차이가 있는지 봅니다. 켤 때마다 측정값이 새로 측정되고, 바로 ←/→/Space로 넘길 수 있어야 합니다.
10. 가로와 세로 쪽이 섞인 PDF를 올려 세로 쪽이 크게 보이는지 확인합니다.
11. `/slide/embed`에서 아무것도 누르지 않고 →를 눌러 보세요. 두 뷰어 모두 그대로여야 합니다. 왼쪽 슬라이드를 클릭한 뒤 →를 누르면 왼쪽만 넘어가야 합니다.

## 6. 검증 근거 (2026-11-12, 자동)
명령어(모두 `pocs/`에서 실행):
```
pnpm exec tsc --noEmit | grep -E '^(slide/|app/slide/|app/api/slide/)'   # 0건
pnpm exec eslint slide app/slide app/api/slide                              # 0건
node --test slide/tests/swipe.test.mjs                                      # 7/7 통과
node slide/tests/e2e.mjs                                                    # 52/52 통과 → .verify/slide/results.json
curl -H 'Range: bytes=0-1023' localhost:3100/api/slide/sample/proposal      # 206, content-range bytes 0-1023/1136635
```

E2E(headless Chrome; 모바일은 390×844, DPR 2, hasTouch, CDP `Input.dispatchTouchEvent`):

| 항목 | 결과 |
|---|---|
| 터치 느린 스와이프(60%) 좌→2, 우→1 / 12% 드래그는 복귀 | 통과 |
| 빠른 flick(45px, 약 30ms) 양방향 | 통과 |
| 드래그 중 손가락 추적(-0.4W → trackX -127.2px) | 통과 |
| 러버밴드: 200px 당김 → 81.7px(처음과 끝 모두), 놓으면 복귀 / 첫 쪽에서 flick해도 1에 고정 | 통과 |
| 세로 스와이프 시 쪽 변화 없음 | 통과 |
| 키보드 →→←, End(12/12), 이전·다음 버튼, 끝에서 다음 버튼 비활성, 썸네일로 5쪽 이동 | 통과 |
| 더블탭 2.5배, 확대 중 이동 시 쪽 유지, 핀치 3배, 더블탭으로 원래대로 | 통과 |
| 전체 화면 열기, 안에서 스와이프, Esc로 닫기 | 통과 |
| 가로 회전(844×390) 후 HiDPI 재렌더(css 471px → canvas 942×530) | 통과 |
| 데스크톱 마우스 드래그 양방향과 flick, 드래그 중 텍스트 선택 없음, reduced-motion이면 transition none, 기본은 200ms | 통과 |
| 파일 입력 업로드(`proposal.pdf` → 58쪽), 비PDF 거부, 깨진 PDF 에러 표시 | 통과 |
| 콘솔 에러, pageerror, fake worker 경고, 실패한 요청 | 0건 |

**성능(58쪽 A4 제안서, 로컬 dev 서버, 모바일 에뮬레이션)**

| 모드 | 문서 로딩 | 첫 페이지 표시(앱 내부 측정) | 이동→첫 페이지 표시(벽시계) | 스와이프 10회: 놓은 뒤 쪽 표시 변경 | 새 쪽 그림 완료 | long task |
|---|---|---|---|---|---|---|
| 렌더 워커 | 132ms | **218ms** | 609ms | 평균 14ms(최대 20) | 평균 15ms(최대 21) | 0 |
| 메인 스레드 | 88ms | 158ms | 548ms | 평균 25ms(최대 45) | 평균 28ms(최대 64) | 0 |

- 12장 덱의 첫 페이지 표시는 141~201ms였습니다.
- 마운트 슬롯은 5개 이하, 페이지 캔버스는 5개 이하로 유지되었습니다(58쪽을 넘겨도 늘지 않음).
- 앞뒤 쪽을 미리 그려 두므로 스와이프 직후 이미 그려진 페이지가 보입니다.

스크린샷(`pocs/.verify/slide/`):
- 모바일 진행 과정: `m01-loaded.png`, `m02-mid-drag.png`, `m03-rubber-band-start.png`, `m04-rubber-band-end.png`, `m05-page5.png`, `m06-zoomed.png`, `m07-fullscreen.png`, `m08-landscape.png`
- 제안서: `p01-proposal.png`, `p02-proposal-page11.png`
- 데스크톱: `d01-desktop-page4.png`
- 업로드: `u01-empty.png`, `u02-uploaded.png`, `u03-broken.png`

발견하고 고친 버그: 터치 시 자식 캔버스가 암묵적으로 포인터를 캡처합니다. 그래서 뷰포트로 캡처를 옮길 때 버블링된 `lostpointercapture`를 제스처 종료로 잘못 처리했고, 손가락 추적과 러버밴드가 깨졌습니다. 이 이벤트는 이제 `e.target === viewport`일 때만 종료로 처리합니다.

### 수정 라운드 1 (리뷰 지적사항, 2026-11-12)
| 지적 | 원인 | 수정 | 검증 |
|---|---|---|---|
| [major] 같은 샘플을 다시 누르거나, 샘플 클릭 직후 Space를 누르면 파일 정보와 측정값이 "불러오는 중…/–"에서 멈춤 | `reset()`으로 측정값을 비웠지만 `src`와 `key`가 같아 뷰어가 다시 로드하지 않음. Space는 포커스된 샘플 버튼을 다시 누름 | 선택할 때마다 `nonce`를 증가시켜 `key`에 넣음. 뷰어가 다시 마운트되어 1쪽부터 다시 로드하고 측정값을 새로 채움. 선택 후 `viewer.focus()`로 포커스를 뷰어로 옮김. 메인 스레드 체크박스도 측정값을 초기화 | `review-e2e` A6, B2 통과. `fixes-r1` M2(재탭 2회 → 1/12, 첫 페이지 표시 67~81ms), D1~D5 통과 |
| [minor] 가로·세로 혼합 PDF에서 세로 쪽이 작게 보임 | 무대 비율이 1쪽 기준 | `stageAspect` prop 추가(`"first"` 기본, `"current"`, 숫자). PoC 화면은 `"current"` | `fixes-r1` X1: 세로 쪽 126×179 → **317×450px**. X2: 1쪽으로 돌아오면 무대가 원래대로 줄고 HiDPI로 다시 렌더(canvas 636 = 318×2) |
| [minor] `toggleFullscreen`이 setState updater 안에서 Fullscreen API 호출 | updater 안의 부수효과(StrictMode에서 두 번 실행) | `fullscreenRef`로 다음 상태를 계산한 뒤 updater 밖에서 API를 호출하고, `fullscreenchange`에서 ref를 동기화 | `fixes-r1` D6: F → 켜짐(상태와 네이티브 일치), F → 꺼짐. D7: 버튼으로 열고 Esc로 닫힘 |
| [minor] `keyboard="global"`이 기본이라 임베드 시 모든 뷰어가 같은 키에 반응 | 기본값 | 기본값을 `"focus"`로 바꿈. `"global"`도 다른 뷰어 안 포커스는 무시. 슬라이드를 누르면 뷰어로 포커스(마우스 `preventDefault`가 기본 포커스를 막으므로 직접 호출) | `/slide/embed` E1: 포커스가 없으면 두 뷰어 모두 1쪽 유지. E2: A를 클릭하면 A만 3쪽. E3: B 버튼을 누른 뒤에는 B만 이동 |
| [minor] README의 `public/fixtures/proposal.pdf` 설명이 사실과 다름 | 사본이 이후 갱신됨 | 해당 문장 삭제(`cmp` 결과 동일) | `cmp fixtures/proposal.pdf public/fixtures/proposal.pdf` 차이 없음 |

재검증 명령(모두 `pocs/`):
```
pnpm exec tsc --noEmit | grep -E '^(slide/|app/slide/|app/api/slide/)'   # 0건
pnpm exec eslint slide app/slide app/api/slide                              # 0건
node --test slide/tests/swipe.test.mjs                                      # 7/7
node slide/tests/e2e.mjs                                                    # 52/52 (회귀 없음; 58쪽 ttfp 155~156ms)
node slide/tests/review-e2e.mjs                                             # 34/34 (이전 A6, B2 실패 → 통과)
node slide/tests/fixes-r1.mjs                                               # 20/20 → .verify/slide/fix1/results.json
```
스크린샷(`pocs/.verify/slide/fix1/`): `f01-mobile-retap.png`(재탭 후 측정값 채워짐), `f02-desktop-space.png`, `f03-mixed-portrait-page.png`(세로 쪽 크게), `f04-embed-two-viewers.png`

### 수정 라운드 2 (리뷰 지적사항, 2026-11-12)
| 지적 | 원인 | 수정 | 검증 |
|---|---|---|---|
| [major] 핀치로 줄이면(<1배) 80% 크기로 고착 | 첫 손가락을 뗄 때 배율이 1 이하면 모드를 `idle`로만 바꿈 → 마지막 손가락 pointerup이 pinch·pan 분기를 모두 건너뛰어 `commitZoom`이 호출되지 않음 | 손가락이 하나 남았을 때 배율이 1.05 미만이면 그 자리에서 `commitZoom`(NO_ZOOM으로 스냅, 200ms 애니메이션) 후 `idle`. 1.05 이상이면 기존처럼 이동(pan) 모드 | `review-r2` F7 통과(`t=''`). `review-r2-repro`: 한 손가락씩 떼도 `zoom 1.00, transform 없음`. `fixes-r2` P1(첫 손가락만 뗀 시점에 이미 1배, 호스트 폭 318/318), P2, P3(두 손가락 동시), P4(남은 손가락으로 끌어도 쪽·배율 유지), P5(이후 스와이프 정상), P6(핀치 확대는 그대로 3배 유지) |
| [major] 트랙패드 두 손가락 스와이프 한 번에 2~9쪽 넘어감 | 휠 상태(`wheelAcc`, `wheelLockUntil`)가 제스처 effect의 지역 변수 → 페이지 크기가 처음 측정될 때마다 effect가 재구독되며 잠금이 0으로 초기화. 고정 450ms 잠금은 macOS 관성(~1초)보다 짧음 | 휠 상태를 `useRef`로 옮기고, 고정 시간 잠금 대신 "휠 이벤트가 200ms 끊길 때까지" 잠금(제스처 단위). 타이머 없이 `e.timeStamp` 간격으로 판정해 재구독·언마운트에도 안전. `deltaMode` 1/2 환산 | `review-r2-repro`: 짧은 제스처 1→2(Δ1), 60개·960ms 관성 제스처 2→3(Δ1) — 이전 Δ2~Δ9. `review-r2-wheel` 1→2, 2→3. `review-r2` E6 2→3. `fixes-r2` W1(새 덱, 크기 측정 중 1→2), W2(300ms 쉬고 두 번 → +2), W3(역방향 −1), W4(`mouse.wheel` 12×30px → +1), W5(350ms 간격 휠 3칸 → +3), W6(줄 단위 −1), W7(46px 살짝 → 0) |
| [minor] 메인 스레드 체크박스 포커스 시 ←/→ 무시, Space가 체크박스 토글 | `isTypingTarget`이 모든 INPUT을 입력 필드로 취급 | 글자 입력형 input만 입력 필드로 판단(checkbox·button·submit·reset·file·image·color 제외). Space는 이런 input·BUTTON·SUMMARY에 맡김(`isActivatable`). 체크박스 토글로 뷰어가 다시 마운트되면 `viewer.focus()` | `review-r2` H4 통과. `fixes-r2` K1(클릭 후 → 2쪽, 포커스 뷰어), K2(Space → 3쪽, 체크 유지), K3(체크박스에 포커스가 있어도 → 동작) |
| [minor] 처음으로/마지막으로/‹ 버튼 클릭 후 Space가 그 버튼을 다시 누름 | Space를 포커스된 BUTTON에 양보 | PoC 화면의 처음으로/마지막으로는 실행 후 `viewer.focus()`. 뷰어 자체 버튼(‹ › 전체 화면, 썸네일)은 포인터 클릭(`detail > 0`)이면 뷰어로 포커스 반환. 키보드로 누른 경우는 버튼에 포커스 유지(접근성) | `review-r2` H5 통과. `fixes-r2` K4(마지막→처음→Space → 2쪽), K5, K6(‹ 클릭 후 Space → +1), K7(썸네일 5 클릭 후 Space → 6), K8(Tab으로 › 버튼에 포커스 + Space → 한 번만 눌림, 포커스 유지) |

재검증 명령(모두 `pocs/`):
```
pnpm exec tsc --noEmit | grep -E '^(slide/|app/slide/|app/api/slide/)'   # 0건
pnpm exec eslint slide app/slide app/api/slide                              # 0건
node --test slide/tests/swipe.test.mjs                                      # 7/7
node slide/tests/e2e.mjs                                                    # 52/52 (회귀 없음)
node slide/tests/review-e2e.mjs                                             # 34/34
node slide/tests/fixes-r1.mjs                                               # 20/20
node slide/tests/review-r2.mjs                                              # 36/36 (이전 E6, F7, H4, H5 실패 → 통과)
node slide/tests/review-r2-repro.mjs; node slide/tests/review-r2-wheel.mjs # 모두 Δ1, 핀치 후 zoom 1.00
node slide/tests/fixes-r2.mjs                                               # 24/24 → .verify/slide/fix2/results.json
```
스크린샷(`pocs/.verify/slide/fix2/`): `p0-pinching-in.png`(핀치 중 0.8배), `p2-after-pinch-in.png`(손가락 뗀 뒤 1배로 무대를 꽉 채움), `p6-pinch-out.png`, `w-desktop-after-wheel.png`, `k-desktop-keyboard.png`

참고: CDP `Input.dispatchTouchEvent`의 `touchEnd`에 점을 넣으면 **그 점이 떼어집니다**(남는 점이 아님). 이후 같은 id로 `touchMove`를 보내면 새 포인터로 들어갑니다. 테스트를 쓸 때 주의하세요.

## 7. 알려진 한계
- **Next dev 라우트 핸들러가 `content-length`를 빼고 chunked로 응답합니다.** 그래서 pdf.js가 샘플 URL에 Range 요청을 쓰지 않고 파일 전체를 스트리밍합니다. 1MB 수준이라 영향은 없지만, 수십 MB짜리 PDF를 URL로 열 때는 정적 파일이나 CDN(정적 서빙은 Content-Length와 Range를 지원)으로 제공하는 편이 낫습니다. 업로드 파일(File)은 메모리에서 바로 읽으므로 해당되지 않습니다.
- 렌더 워커 모드에서 쓰인 캔버스는 OffscreenCanvas로 넘어가 `width=0`으로 즉시 해제할 수 없습니다. DOM에서 제거된 뒤 GC에 맡기며, 실기기 메모리 프로파일은 아직 재지 않았습니다.
- 텍스트 레이어와 링크 주석은 그리지 않습니다(슬라이드 보기 용도라 캔버스만 씀). 텍스트 선택과 검색은 되지 않습니다.
- 핀치 확대는 CDP 합성 터치로만 검증했습니다. iOS Safari 실기기의 제스처 충돌(시스템 줌, 뒤로 가기 스와이프)은 HIL에서 확인해야 합니다.
- 트랙패드 제스처는 "휠 이벤트 200ms 공백"으로 구분합니다. 첫 스와이프의 관성이 끝나기 전에 다음 스와이프를 시작하면 한 제스처로 합쳐져 한 쪽만 넘어갑니다(macOS가 관성 중 새 제스처를 따로 표시해 주지 않음). 연속으로 빠르게 넘기려면 키보드나 버튼이 낫습니다. 실제 Mac 트랙패드 감도는 합성 이벤트로만 검증했으므로 HIL 7-2에서 확인이 필요합니다.
- 확대 상태에서 페이지 가장자리까지 끌어도 다음 쪽으로 넘어가지 않습니다. 확대를 풀거나 버튼, 키보드를 써야 합니다.
- 가로로 돌린 휴대폰에서는 화면 높이의 68%만 차지해서 작게 보입니다. 이때는 전체 화면을 권장합니다.
- 샘플 API는 항상 `fixtures/` 원본을 제공합니다(`public/fixtures/`의 사본과 현재 내용이 같음).
- `stageAspect="current"`이면 비율이 다른 쪽으로 넘어갈 때 무대 높이가 바뀌어 아래 내용이 함께 움직입니다. 넘기는 도중에는 이웃 쪽이 현재 무대 비율에 맞춰 작게 보이다가 넘긴 뒤 커집니다. 높이 변화에는 애니메이션이 없습니다.
- 썸네일 칸은 1쪽 비율을 따릅니다. 다른 비율의 쪽은 늘이지 않고 칸 안에 맞춰(`object-fit: contain`) 작게 보입니다.
- 같은 샘플을 다시 누르면 의도적으로 1쪽부터 다시 엽니다(재측정용). 보던 쪽은 유지되지 않습니다.

## 8. 다음 단계
- 발표 화면(`ui` 03-presentation)의 `SlideStage`를 `SlideViewer`로 교체합니다. 이때 `thumbnails={false}`, `--slide-max-h`를 조정하고, 카메라 PiP 오버레이 슬롯(children)을 추가합니다.
- `onPageChange`를 STT 전사와 묶어 "몇 쪽에서 무슨 말을 했는지"를 기록합니다. `TranscriptSentence`에 slide 번호 필드를 넣자고 제안합니다. report와 question PoC에서 쪽별 분석에 쓸 수 있습니다.
- 업로드 PDF를 IndexedDB에 캐시해 새로고침이나 이어하기 때 다시 업로드하지 않게 합니다. 첫 페이지 썸네일을 미리 만들어 목록 화면에서 씁니다.
- 실기기 HIL(iPhone Safari, Android Chrome)에서 스와이프 임계값(22%, 0.45px/ms)을 조정하고 메모리를 프로파일링합니다.
