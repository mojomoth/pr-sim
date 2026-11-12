# PR-SIM PoC 호스트 (`pocs/`)

PR-SIM은 발표 연습 웹앱입니다. 사용자가 PDF 슬라이드로 발표하면 실시간으로 음성을 전사하고, 얼굴과 목소리가 있는 AI 심사위원이 질문한 뒤 리포트를 줍니다.
이 폴더는 본 개발 전에 기능을 하나씩 검증하는 **PoC 7개와 공용 테스트 데이터**를 한 Next.js 앱에 모은 것입니다. 사람이 직접 확인하는 단계(HIL)를 위해 웹으로 엽니다.

- **HIL 시작점: http://localhost:3100/hil** (PoC별 체크리스트, 남은 이슈, 결정이 필요한 사항, 체크·피드백 저장)
- PoC 허브: http://localhost:3100/
- 멀티에이전트 개발 관측: http://localhost:3100/devlog

## 실행

```bash
cd pocs
pnpm install
pnpm dev -p 3100          # = pnpm exec next dev -p 3100
```

- API 키는 `pocs/.env.local`(`../.env`의 심볼릭 링크)에서 읽습니다: `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_API_KEY`. 서버에서만 쓰고 클라이언트 번들에 넣지 않습니다.
- 런타임 데이터(위키, 생성 이미지, 세션, 리포트, TTS 캐시)는 `pocs/.data/<poc>/`에 쌓입니다. 지우면 처음 상태가 됩니다.
- 검증 산출물(스크린샷, JSON 로그)은 `pocs/.verify/<poc>/`에 있습니다.
- 프로덕션 빌드: `pnpm exec next build` (dev 서버는 `.next/dev`를 쓰므로 실행 중인 dev 서버와 함께 돌릴 수 있습니다).

### 지금 알아 둘 제공자 상태 (2026-11-13)

| 제공자 | 상태 | 영향 |
|---|---|---|
| Claude | 사용 한도 초과, 2026-12-01 복구 | Claude 우선 경로는 모두 OpenAI·Gemini로 폴백 |
| OpenAI | 크레딧 0 (429) | 위키 새 인제스트, 심사위원 얼굴 생성, gpt-5.5 질문·채점 불가 |
| Gemini | 무료 등급 (모델별 하루 10~25회) | Live STT는 동작. TTS·배치 전사·flash 모델은 한도가 빨리 끝남 |

실시간 상태는 `/hil` 상단 카드 또는 `GET /api/hil/providers`(제공자마다 짧은 호출 1회, 60초 캐시)로 확인합니다. **안정적인 HIL을 하려면 OpenAI 크레딧 충전(또는 Gemini 유료 등급)이 필요합니다.** 충전하면 코드 수정이나 재시작 없이 원래 경로로 돌아옵니다.

## 라우트 맵

| 경로 | PoC | 설명 | README |
|---|---|---|---|
| `/` | 호스트 | PoC 허브 + 진행 상태 | |
| `/hil` | hil | HIL 검증 체크리스트 | [hil/README.md](hil/README.md) |
| `/devlog` | 호스트 | 에이전트 개발 로그 실시간 보기 | |
| `/fixtures` | fixtures | 공용 테스트 데이터(덱 12장, 제안서 58쪽, 대본, 음성, 샘플 세션) | [fixtures/README.md](fixtures/README.md) |
| `/ui`, `/ui/setup`, `/ui/presentation`, `/ui/review`, `/ui/results`, `/ui/feedback`, `/ui/history`, `/ui/screens` | ui | DESIGN.md 시안 7개 화면 (목업 데이터) | [ui/README.md](ui/README.md) |
| `/stt-tts` | stt-tts | Gemini 문장 단위 STT, 페르소나 TTS | [stt-tts/README.md](stt-tts/README.md) |
| `/wiki` | wiki | 업로드 PDF → Karpathy LLM Wiki | [wiki/README.md](wiki/README.md) |
| `/judge` | judge | gpt-image-2 실사 심사위원 얼굴 | [judge/README.md](judge/README.md) |
| `/slide`, `/slide/embed` | slide | PDF 좌우 스와이프 뷰어 | [slide/README.md](slide/README.md) |
| `/question` | question | 전사·자료 기반 페르소나 질문, 꼬리질문, 질의응답 | [question/README.md](question/README.md) |
| `/report` | report | 발표·질의응답·자료 품질 리포트 | [report/README.md](report/README.md) |

API 라우트 (`next build` 출력 기준 37개):

- 호스트: `GET /api/devlog`, `GET /api/hil/providers[?force=1]`
- ui: `GET /api/ui/fixture?slot=presentation|proposal`
- stt-tts: `POST /api/stt-tts/token` (Live 1회용 토큰), `POST /api/stt-tts/transcribe`, `POST /api/stt-tts/tts`
- wiki: `GET /api/wiki/docs`, `POST /api/wiki/ingest`, `GET|POST|DELETE /api/wiki/docs/{docId}`, `…/events`(SSE), `…/pages`, `…/pages/{slug}`, `…/raw/{page}`, `…/pdf`, `…/query`, `…/lint`, `…/answers`, `…/repair`
- judge: `POST /api/judge`, `POST /api/judge/panel`(NDJSON), `GET|DELETE /api/judge/{id}`, `GET /api/judge/image/{id}`
- slide: `GET /api/slide/sample/{name}`
- question: `/api/question/setup|generate|followup|retry|tts|runs|runs/{id}|sessions|sessions/{id}`
- report: `/api/report/generate|health|sessions|sessions/{ref}|reports/{key}`

## 호스트 구조

```
pocs/
├─ app/                     Next.js 16.4 App Router (React 19.3, Tailwind v4). 라우트 파일은 얇게 두고 @/<poc>/...를 import
│  ├─ <poc>/page.tsx        각 PoC 화면 (/ui, /wiki, ...)
│  ├─ api/<poc>/**          각 PoC 라우트 핸들러 (서버 전용)
│  ├─ devlog/, page.tsx     호스트 화면 (/devlog, /)
│  ├─ globals.css           DESIGN.md 토큰 → Tailwind 색 (bg-canvas, bg-surface, bg-card, text-ink, text-secondary, text-error …)
│  └─ layout.tsx            Pretendard 로드, lang=ko
├─ <poc>/                   PoC 기능 코드: components/, lib/, tests/, README.md (ui, stt-tts, wiki, judge, slide, question, report, fixtures, hil)
├─ lib/ai.ts                서버 전용 공용 클라이언트 gemini(), openai(), claude()와 MODELS
├─ lib/types.ts             PoC 간 계약: Temperament, JudgePersona, TranscriptSentence, QAItem, SessionRecord
├─ lib/pocs.ts              허브·devlog에 보이는 PoC 목록
├─ components/DevlogBoard   /devlog, / 의 이벤트 보드
├─ scripts/devlog.mjs       관측 이벤트 기록 CLI
├─ scripts/browser.mjs      헤드리스 Chrome 검증 헬퍼 (에이전트마다 자기 브라우저, 가짜 카메라·마이크)
├─ scripts/pnpm-add.sh      병렬 에이전트용 직렬화된 의존성 추가
├─ public/<poc>/            PoC별 정적 파일
├─ .data/<poc>/             런타임 데이터 (git 제외 권장)
└─ .verify/<poc>/           검증 스크린샷·로그
```

PoC 간 데이터 흐름 (실제 앱에서 이어 붙일 순서):

```
업로드 PDF ──▶ slide (SlideViewer로 표시)
           └─▶ wiki.ingestPdf ──▶ queryWiki / lintWiki / getKeyNumbers ─┐
마이크 ──▶ stt-tts (Live STT, 문장 단위 TranscriptSentence) ──────────────┤
성향 3종 ──▶ judge (얼굴 이미지 + voiceHint) ──▶ stt-tts TTS 음성 매핑 ────┤
                                                                         ▼
                                      question (질문 생성 → 답변 평가 → 꼬리질문, SessionRecord 저장)
                                                                         ▼
                                      report (발표 분석 + 질의응답 타당성 + 자료 품질 → 점수·피드백)
ui ── 위 결과를 보여 줄 7개 화면 (현재 목업 데이터)
```

연결 상태: question은 wiki·stt-tts·judge를, report는 wiki와 question 세션을 실제로 import해 씁니다. ui는 아직 목업이며 다른 PoC와 연결하지 않았습니다.

## 관측 (멀티에이전트 개발)

- `scripts/devlog.mjs <poc> <status> "<메시지>" --agent <이름> [--file <경로>]`가 `devlog/events.jsonl`에 한 줄씩 추가합니다. status: `queued | in_progress | verifying | issue | fixed | done | failed | note`.
- `/devlog`는 `GET /api/devlog`를 2.5초마다 읽어 PoC별 최신 상태와 전체 타임라인을 보여 줍니다. `/`에도 요약 보드가 있습니다.
- 에이전트 구성: PoC마다 build 에이전트 → review 에이전트(독립 검증, pass/fail) → fail이면 fix 에이전트 → 재리뷰를 반복했고, 마지막에 final 에이전트가 통합 검증과 `/hil`을 만들었습니다. 이력은 events.jsonl의 `agent` 필드(`build:<poc>`, `review:<poc>`, `fix:<poc>`, `final`)로 추적할 수 있습니다.

## 통합 검증 결과 (final, 2026-11-13)

| 항목 | 명령 | 결과 |
|---|---|---|
| 타입체크 | `pnpm exec tsc --noEmit` | 오류 0 |
| 린트 | `pnpm exec eslint .` | 오류 0, 경고 5 (`<img>` 2건, Landing.tsx 2건, ui 리뷰 테스트 1건). 생성물(.verify, pdf.js 번들) 무시 설정 추가 |
| 프로덕션 빌드 | `pnpm exec next build` | 성공, 페이지 19 + API 37. 경고 6건: 동적 fs 경로로 NFT가 프로젝트 전체를 추적(judge/lib/store.ts, report/lib/sessions.ts, ui/lib/fixture.ts, wiki/lib/http.ts) — 배포 전 정리 필요 |
| 라우트 스모크 | `node hil/tests/smoke.mjs` / `--desktop` | 19개 페이지 모두 200, 콘솔 오류 0, 가로 넘침 0 (모바일 390×844, 데스크톱 1280). 스크린샷 `.verify/final/` |
| HIL 페이지 | `node hil/tests/hil-page.mjs` | 22/22 PASS |
| 제공자 프로브 | `node --env-file=.env.local hil/tests/provider-probe.mjs` | Claude 400(한도), OpenAI 429(크레딧 0), Gemini OK |

## PoC 현황

| PoC | 최종 리뷰 | 남은 이슈 |
|---|---|---|
| fixtures | PASS (1차) + 지적 5건 수정 | 음성은 Gemini 대신 OpenAI TTS로 생성 |
| ui | PASS (3차) | minor 5 (01 시안 썸네일 오래됨, 5인 피드백 1/4, 새로고침 시 타이머 리셋, 목업 Q/A 불일치, 화살표 키 포커스) |
| stt-tts | PASS (1차) + 지적 4건 수정 | Gemini 무료 한도, 공용 가짜 마이크 무음(macOS) |
| wiki | 3차 리뷰 fail → 6건 수정, **재리뷰 없음** | '다시 만들기' 성공 경로는 실제 LLM 미검증 |
| judge | PASS (2차) | minor 4, OpenAI 크레딧 없으면 생성 불가 |
| slide | PASS (3차) | minor 1 (스냅 중 다시 잡으면 54px 튐) |
| question | PASS (3차) | minor 6, 세 제공자 모두 막히면 저장된 실행 재생만 가능 |
| report | PASS (3차) | minor 5 (분당 막대 축척, 영어 enum 노출, 상황 부제 잘림 등) |

## 공통 한계

- Claude 경로는 모든 PoC에서 실호출로 검증하지 못했습니다(키 한도). 실제 품질 검증은 OpenAI(gpt-5.5, gpt-5.4-mini/nano)와 Gemini로 했습니다.
- 모든 PoC가 단일 Node 프로세스와 파일시스템(`.data/`)을 전제하고, 인증·사용자 분리가 없습니다.
- 브라우저 검증은 헤드리스 Chrome(가짜 카메라·마이크, 합성 터치)으로만 했습니다. iOS Safari·Android 실기기는 HIL에서 확인해야 합니다.
- 공용 `scripts/browser.mjs`의 `fakeAudioWav`는 macOS에서 무음입니다. `--disable-features=AudioServiceSandbox`를 추가해야 합니다(stt-tts/tests/launch.mjs 참고).
- `next build`의 NFT 경고(동적 fs 경로)는 배포 크기를 키웁니다. 경로를 `path.join(process.cwd(), '.data', <poc>, …)`처럼 정적으로 묶거나 `/*turbopackIgnore: true*/`를 붙여야 합니다.

## 결정이 필요한 사항 (요약)

1. **LLM 결제**: OpenAI 충전 또는 Gemini 유료 전환 (HIL 전 필수).
2. **기본 모델**: Claude 복구(12/1) 후 Claude vs gpt-5.5를 같은 테스트로 비교해 wiki·question·report 기본 모델 결정.
3. **STT 방식**: Live(1.4~1.7초, experimental) 기본 + 구간 전사 폴백 유지 여부.
4. **TTS 제공자**: Gemini 유료 vs OpenAI TTS 공식 폴백.
5. **파이프라인 시점**: 업로드 직후 위키·얼굴 백그라운드 생성, 발표 종료 순간 질문 생성, 질의응답 중 발표 분석 선행.
6. **정책 값**: 심사위원 최대 인원·질문 수, PDF 용량 제한, 리포트 가중치(25/25/30/20)와 전달 지표 기준, 덱↔제안서 수치 불일치 감점 정책.
7. **저장소·인증·작업 큐** 설계와 실기기 검증 범위.

PoC별 세부 결정은 `/hil`의 각 카드와 PoC README에 있습니다.
