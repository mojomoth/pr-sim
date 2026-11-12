# v1 앱 구조: 화면 → 파일 → API

`app/`의 화면 라우트가 어느 파일에 있고, 어떤 API를 부르며, 그 API가 어느 서버 모듈로 이어지는지 정리한 지도입니다. 요청·응답 형식은 [api-contract.md](api-contract.md)를, 결정 근거와 실측은 [report.md](../dev-v1/report.md) 4–7절을 봅니다. 기준 시점은 2026-11-13 G3 배포(https://pr-sim-lake.vercel.app)입니다.

## 화면

모든 화면은 빌드 결과에서 정적(○)입니다. 세션은 경로가 아니라 쿼리 파라미터 `?s=<id>`로 받습니다(Capacitor 정적 내보내기 대비).

| 경로 | 시안 | 파일 (`app/src/app/`) | 부르는 API | 저장소 |
|---|---|---|---|---|
| `/` | 01 랜딩 | `page.tsx` | 없음 | 없음 |
| `/setup[?s=]` | 02 설정 | `setup/page.tsx`, `setup/SetupScreen.tsx`, `setup/draft.ts` | `/api/judges`, `/api/wiki`(자료마다) | 초안 세션, PDF·얼굴 blob |
| `/present?s=` | 03 발표 | `present/page.tsx`, `present/PresentScreen.tsx`, `present/shared.tsx` | `/api/stt/token` | 전사(`phase: presentation`), `resume` |
| `/qa?s=` | 04 질의응답 | `qa/page.tsx`, `qa/QaScreen.tsx` | `/api/questions`, `/api/tts`, `/api/questions/followup`, `/api/stt/token` | 질문 묶음, QA 항목, 전사(`phase: qa`) |
| `/result?s=` | 05 결과 | `result/page.tsx`, `result/ResultScreen.tsx`, `result/Summary.tsx`, `result/cite.tsx` | `/api/report`, 빠진 위키가 있으면 `/api/wiki` 먼저 | 리포트 |
| `/result?s=&tab=feedback` | 06 피드백 | `result/Feedback.tsx`, `result/notes.tsx` | 없음(저장된 리포트) | 읽기만 |
| `/history` | 07 기록 | `history/page.tsx`, `history/HistoryScreen.tsx` | 없음 | 목록·삭제 |

공용 UI는 `app/src/components/`(헤더·레이아웃·목업 프레임, 심사위원 카드, 카메라, 타이머, 대화상자 등), 전역 스타일은 `app/src/app/globals.css`와 `layout.tsx`에 있습니다.

## 클라이언트 코어

| 모듈 | 역할 |
|---|---|
| `features/session/api.ts` | 7개 API 호출, NDJSON 스트림 읽기, 전송 전 본문 크기 검사, 오류를 `ApiError`로 통일 |
| `features/session/db.ts`, `types.ts` | IndexedDB `pr-sim`(`sessions`, `blobs`)과 세션 타입 |
| `features/session/useCountdown.ts` | 실제 시각 기준 타이머 |
| `features/stt/` | Gemini Live 전사(`useSentenceTranscriber.ts`), 문장 나누기, 음성 구간 감지 |
| `features/slide/` | pdf.js 렌더(`SlideViewer.tsx`), 쪽별 텍스트 추출(`pdf.ts`), 스와이프 |
| `platform/` | 카메라·마이크·저장소·오디오 재생 인터페이스(`index.ts`)와 web 구현(`web/*`). `config.ts`의 `NEXT_PUBLIC_API_BASE`로 네이티브 빌드가 배포 서버를 가리킴 |

## API → 서버 모듈

공통 처리(출처 검사, `ALLOWED_ORIGINS` CORS, 인메모리 레이트리밋, 4MB 본문 상한, zod 검사, 오류 JSON)는 `server/http/index.ts`에, AI 클라이언트와 모델 id는 `server/ai/index.ts`에 있습니다.

| 라우트 (`app/src/app/api/`) | maxDuration | 서버 모듈 (`app/src/server/`) | 제공자 순서 |
|---|---|---|---|
| `stt/token` | 10 | `stt/token.ts` | Gemini `gemini-3.5-transcribe-live` |
| `tts` | 60 | `tts/speech.ts`, `persona.ts`, `wav.ts` | Gemini TTS 2종 → OpenAI `gpt-4o-mini-tts`, 모두 실패하면 503 |
| `judges` | 120 | `judge/generate.ts`, `traits.ts` | OpenAI `gpt-image-2`만 |
| `wiki` | 300 | `wiki/ingest.ts`, `schema.ts`, `store.ts`, `llm.ts` 외 | OpenAI → Claude |
| `questions` | 120 | `question/generate.ts`, `context.ts`, `schema.ts`, `llm.ts` 외 | OpenAI → Gemini → Claude |
| `questions/followup` | 60 | `question/followup.ts`, `guards.ts` | OpenAI → Gemini → Claude |
| `report` | 300 | `report/generate.ts`, `metrics.ts`, `llm.ts`, `schema.ts` 외 | OpenAI 3종 → Gemini → Claude |

## 출처

- 코드: `app/src/app/**`, `app/src/features/session/api.ts`, `app/src/platform/config.ts`, `app/src/server/ai/index.ts`, `app/src/server/{question,report,wiki}/llm.ts`
- 빌드 결과(정적·동적 구분): `app/.verify/g3/deploy/10-build.log`
- maxDuration: `app/.verify/g3/deployed/round1/fs-grep.txt`
- 결정: [report.md](../dev-v1/report.md) D11–D19, [run.md](../dev-harness/v1/run.md) 고정 결정
