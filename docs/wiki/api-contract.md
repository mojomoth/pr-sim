# v1 최소 API 계약

> G0 산출물. 기준: [run.md 고정 결정](../dev-harness/v1/run.md) — 서버 무상태, 기록은 브라우저 IndexedDB, PDF는 브라우저 pdf.js로 쪽별 텍스트 추출, 서버엔 **쪽 텍스트만** 전송(Vercel 본문 4.5MB), 키는 Route Handler에서만.
> 경로는 `app/src/app/api/**/route.ts`. 재사용 원본은 `pocs/` 기준 경로. 모델 기본값은 `docs/dev-v1/report.md`에서 확정(아래는 PoC 폴백 체인 그대로).

## 공통 규칙

- 모든 라우트: `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`, 응답 `cache-control: no-store`. 서버는 파일·DB에 아무것도 쓰지 않음(`.data/` 디스크 캐시 전부 제거).
- 출처 검사: `pocs/stt-tts/lib/http.ts`의 `sameOrigin()` — token은 strict, 나머지는 lenient. 분당 제한(`RATE_LIMITS`)은 인스턴스 메모리라 참고용.
- 본문 상한: `content-length > 4_000_000` → 413. 클라이언트도 전송 전 `new Blob([json]).size`로 같은 검사.
- 오류 JSON(모든 라우트 공통): `{ error: { code, message, retryAfterSec? } }` — `message`는 화면에 그대로 쓰는 한국어. 스트림 라우트는 마지막 줄 `{ "type": "error", code, message, retryable }`.

| code | HTTP | 기본 문구 |
|---|---|---|
| `bad_request` | 400 | 요청 형식이 올바르지 않아요. (zod issue 포함) |
| `forbidden` | 403 | 허용되지 않은 요청이에요. |
| `too_large` | 413 | 자료가 너무 길어요. 최대 120쪽·15만 자까지 쓸 수 있어요. |
| `unsupported` | 422 | 텍스트가 없는 PDF(스캔본)는 아직 지원하지 않아요. / 이미지 생성이 정책상 거절됐어요. 다시 시도해 주세요. |
| `rate_limited` | 429 | 요청이 많아요. N초 뒤 다시 시도해 주세요. (`retry-after` 헤더) |
| `providers_unavailable` | 503 | AI 모델을 지금 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요. (Gemini 일일 한도 포함) |
| `timeout` | 504 | 응답 시간이 초과됐어요. 다시 시도해 주세요. |
| `upstream` | 502 | AI 서비스 오류가 났어요. 다시 시도해 주세요. |

공용 입력 `DocInput` (자료 1개, 위키·질문·리포트 라우트가 같이 씀):

```ts
interface DocInput {
  role: "presentation" | "proposal";
  docId: string;              // sha256(PDF bytes) 앞 16자, 클라이언트 계산
  filename: string;
  pageTexts: string[];        // pdf.js 쪽별 텍스트, index 0 = p.1
  wiki?: WikiPage[];          // /api/wiki 결과 (질문·리포트에서는 필수)
  keyNumbers?: KeyNumber[];   // pocs/wiki/lib/types.ts
}
interface WikiPage { slug: string; title: string; type: PageType; summary: string; sources: number[]; markdown: string } // markdown 안 인용은 (p.N)
```

## 라우트 (7개)

| # | 메서드·경로 | 요청 | 응답 | maxDuration | 재사용 (pocs/) |
|---|---|---|---|---|---|
| 1 | `POST /api/stt/token` | 본문 없음, 또는 `{ vocabulary?: string[] }`(세션 위키 용어 → Live `customVocabulary`) | `{ token, model, expiresAt }` — 1회용 Gemini Live 토큰(30분, 모델·설정 잠금) | 10 | `stt-tts/lib/server.ts` `mintLiveToken`, `stt-tts/lib/http.ts`, `app/api/stt-tts/token/route.ts` |
| 2 | `POST /api/tts` | `{ text(1–1200자), gender, age(20–70), temperament }` | `audio/wav` + `x-provider`, `x-voice`, `x-model`, `x-duration` | 60 | `question/lib/tts.ts` `judgeSpeech`(Gemini TTS 4모델 → OpenAI `gpt-4o-mini-tts`), `stt-tts/lib/server.ts` `synthesizeSpeech`, `stt-tts/lib/persona.ts`, `stt-tts/lib/wav.ts` |
| 3 | `POST /api/judges` | `{ temperaments: Temperament[] (1–3), avoid?: RollAvoid }` — 한 명 교체는 길이 1 + 기존 패널을 `avoid`로 | `application/x-ndjson`: `{type:"judge", slot, judge: JudgeOut}` · `{type:"error", slot, code, message}` · `{type:"done", ms}` | 120 | `judge/lib/index.ts` `startPanel`/`generateJudge`/`toPersona`, `judge/lib/traits.ts`, `judge/lib/errors.ts` |
| 4 | `POST /api/wiki` | `{ doc: DocInput(wiki 없이) }` | NDJSON: `{type:"progress", phase, chunksDone, chunksTotal, roundsDone, roundsTotal}` … `{type:"done", wiki: WikiPage[], keyNumbers: KeyNumber[], usage}` | 300 | `wiki/lib/ingest.ts`(extract→plan→merge→finalize), `prompts.ts`, `llm.ts`, `numbers-verify.ts`, `reground.ts`, `markdown.ts`, `errors.ts` |
| 5 | `POST /api/questions` | `{ situation, qaMinutes, presentationMinutes, transcript: TranscriptSentence[], docs: DocInput[], judges: QJudge[] (1–3), avoidQuestions?, pack?: ContextPack, lint?: LintIssue[] }` — `pack`이 있으면 컨텍스트 재사용(실패한 심사위원만 다시 생성) | NDJSON `GenerateEvent`(stage·context·plan·delta·question·judge-done) + `{type:"done", order, main, reserve, pack: ContextPack, lint: LintIssue[]}` | 120 | `question/lib/context.ts` `buildContext`, `generate.ts`, `ground.ts`, `personas.ts`, `schema.ts`, `text.ts`, `llm.ts`, `providers.ts`, `wiki/lib/query.ts`, `wiki/lib/lint.ts` |
| 6 | `POST /api/questions/followup` | `{ packText, judge: QJudge, asked: GeneratedQuestion, original: GeneratedQuestion, answer, thread: {question,answer}[], followupsSoFar, remainingSec, pending: GeneratedQuestion[], transcript, docs: {role, pageTexts}[] }` — run·attempt 파일 대신 클라이언트가 세션에서 꺼내 보냄(`docs`·`transcript`는 꼬리질문 근거 대조용) | `FollowUpResult`(`attemptId` 제외): `{ decision, assessment, remark, followup, guard? }` | 60 | `question/lib/followup.ts` `followUp`, `guards.ts`(`clampRemark`, `duplicateOfPending`), `ground.ts` |
| 7 | `POST /api/report` | `{ session: ReportInput, provider? }` — `ReportInput = { id, situation, presentationMinutes, qaMinutes, judges: {id,name,temperament}[], transcript, qa: QAItem[], docs: DocInput[], lint?: LintIssue[] }` | NDJSON `ProgressEvent`: `steps` → `step`… → `{type:"done", report: Report}` 또는 `error{failedSteps, retryable}`(미완성 리포트는 보내지 않음) | 300 | `report/lib/generate.ts`, `context.ts`, `metrics.ts`, `prompts.ts`, `llm.ts`, `types.ts` |

- `JudgeOut = JudgePersona & { gender, age, fullName, voiceHint, image: { mime: "image/webp", base64 } }` — 1024px webp(60–120KB) 1장만. 256px 썸네일은 클라이언트가 `createImageBitmap`+캔버스로 만듦(서버 `sharp` 제거). 화질은 `low` 고정, `simulateError`·`quality`는 넣지 않음.
- 위키 입력 상한: 쪽 ≤ 120, 전체 ≤ 150,000자(실측 58쪽·10만 자 125초, 128쪽·20만 자 240초 → 300초 안 여유). 넘으면 413. 텍스트 있는 쪽이 30% 미만이면 422. 남은 시간이 20초 아래로 떨어지면 504로 끊음. 정책값은 report.md에서 확정.
- 위키·질문·리포트 서버 코드는 `docId` 대신 요청으로 받은 `DocInput`을 메모리 `WikiDoc`으로 감싸 씀(`readRawPage`/`readWikiPage`/`listWikiPages`/`getKeyNumbers` 시그니처를 `(doc, …)`로 변경). `queryWiki`는 `selector:"lexical"`, `save` 없음.
- 리포트의 전사 참조는 PoC의 배열 index 대신 `TranscriptSentence.id` 문자열: `SlideCoverage.sentences → sentenceIds`, `FillerExample.index → sentenceId`, `PauseHit.afterIndex → afterSentenceId`. 문서 인용은 기존 `DocRef { doc, pages, quote, grounded }`.
- 보류(STT 결정 #3): `POST /api/stt/transcribe`(오디오 → `{ text, sentences }`, `stt-tts/lib/server.ts` `transcribeAudio`). Live 실패 시 폴백을 유지하기로 하면 추가. 무료 등급 일일 25회라 기본 경로에는 넣지 않음.

## 클라이언트 저장 (IndexedDB `pr-sim`)

스토어 2개: `sessions`(keyPath `id`) · `blobs`(key → Blob: PDF 원본 `pdf:<docId>`, 심사위원 사진 `judge:<id>`, `judge:<id>:thumb`). `pocs/lib/types.ts`의 타입을 그대로 확장.

```ts
interface TranscriptSentence { id: string; t: number; text: string; phase: "presentation" | "qa"; slide?: number } // t = 단계 시작 후 초, slide = 그때 보던 쪽(1부터)

interface StoredDoc {
  role: "presentation" | "proposal"; docId: string; filename: string; bytes: number; pageCount: number;
  pdfKey: string;                     // blobs 키
  pageTexts: string[]; emptyPages: number[];
  wikiState: "pending" | "building" | "ready" | "error"; wikiError?: string;
  wiki?: WikiPage[]; keyNumbers?: KeyNumber[]; wikiBuiltAt?: string;
}

interface StoredJudge extends JudgePersona {   // id, name, temperament, gender, age
  gender: Gender; age: number; fullName: string; voiceHint: string;
  imageKey: string; thumbKey: string;         // imageUrl은 런타임에 URL.createObjectURL
}

type StoredQA = QAItem & {                     // judge, question, answer, askedAt
  questionId: string; followup?: boolean; evidence: Evidence[];
  answerSentenceIds: string[];                 // transcript(phase "qa") 중 이 답변 문장
  assessment?: AnswerAssessment; decision?: "followup" | "next"; remark?: string;
};

interface SessionRecord {
  id: string;
  status: "setup" | "presentation" | "qa" | "report" | "done";
  resume?: { phase: "presentation" | "qa"; remainingSec: number };   // 07 목록 "이어하기"
  setup: { situation: string; presentationMinutes: number; qaMinutes: number };
  docs: { presentation?: StoredDoc; proposal?: StoredDoc };
  judges: StoredJudge[];
  transcript: TranscriptSentence[];
  questions?: { pack: ContextPack; lint: LintIssue[]; items: GeneratedQuestion[]; order: string[]; main: string[]; reserve: string[] };
  qa: StoredQA[];
  report?: Report;                             // DocRef(쪽) + sentenceId(전사) 인용
  createdAt: string; updatedAt: string; finishedAt?: string;
}
```

## PoC → `app/src` 이전표

| PoC | 옮김 (→ 위치) | 버림 |
|---|---|---|
| 공용 | `lib/ai.ts` → `features/ai/server.ts` · `lib/types.ts` → `features/session/types.ts`(위 확장) | `lib/pocs.ts`, `components/DevlogBoard`, `scripts/devlog.mjs`, `scripts/pnpm-add.sh`, `hil/**`, `devlog/**`, `/api/devlog`, `/api/hil/*` |
| ui | `ui/components/*` → `components/`(UI Builder) · `ui/screens/*` → `app/**` 화면 기반 · `lib/useCountdown.ts` → `features/session/` · `lib/useMedia.ts` → `platform/web/media.ts` | `lib/mock.ts`, `lib/useMockStt.ts`, `lib/fixture.ts` + `/api/ui/fixture`, `lib/store.ts`(sessionStorage → IndexedDB), `lib/pdf.ts`(slide 것으로 통일), `screens/ScreensIndex.tsx`, `scripts/`, `tests/` |
| stt-tts | `lib/sentences.ts`, `lib/persona.ts`, `lib/wav.ts`, `lib/server.ts`(`mintLiveToken`, `synthesizeSpeech`, 디스크 캐시 제거), `lib/http.ts`, `client/useSentenceTranscriber.ts`, `client/vad.ts` → `features/stt/` · `client/mic.ts`, `client/playWav.ts` → `platform/web/` · `public/stt-tts/pcm16k-worklet.js` → `app/public/` | `components/*`, `tests/`, `transcribeAudio`·`/transcribe`(보류) |
| wiki | `lib/ingest.ts`(작업 레지스트리·SSE·스테이징·reingest·log 제거), `query.ts`, `lint.ts`, `prompts.ts`, `llm.ts`, `numbers-verify.ts`, `reground.ts`, `markdown.ts`, `errors.ts`, `types.ts` → `features/wiki/` (+ 메모리 `WikiDoc`) | `lib/store.ts`, `lib/http.ts`, `saveAnswer`·`repairWiki`·`deleteDoc`, unpdf 추출, `components/*`, `scripts/`, `tests/`, `/api/wiki/**` 13개 |
| judge | `lib/traits.ts`, `lib/errors.ts`, `lib/model.ts`(축소), `lib/index.ts`(`generateJudge`·`startPanel`, 저장 제거) → `features/judge/` | `lib/store.ts`, `lib/http.ts`, sharp 썸네일·card 변형, `/api/judge/image`, `components/*`, `tests/` |
| slide | `components/SlideViewer.tsx`, `lib/swipe.ts`, `lib/pdf.ts`(+`extractPageTexts`) → `features/slide/` · `scripts/sync-pdfjs.mjs` + `public/slide/pdfjs/` → `app/public/pdfjs/` | `SlidePage.tsx`, `EmbedDemo.tsx`, `lib/samples.ts` + `/api/slide/sample`, `tests/` |
| question | `lib/context.ts`(lint 캐시 제거, `WikiDoc` 입력), `generate.ts`(`saveRun` 제거), `followup.ts`(`loadRun`/attempt 대신 요청 입력), `guards.ts`, `ground.ts`, `personas.ts`, `schema.ts`, `text.ts`, `llm.ts`, `providers.ts`, `types.ts`, `tts.ts`(캐시 제거) → `features/question/` | `lib/store.ts`, `lib/session.ts`, `retryJudges`(→ `pack` 재사용), `components/*`, `samples/`, `tests/`, setup·runs·sessions·retry·tts 라우트 |
| report | `lib/generate.ts`(파일 캐시·globalThis 재사용·마이그레이션 제거), `context.ts`(fixtures 인제스트·lint 디렉터리 제거), `metrics.ts`, `prompts.ts`, `llm.ts`, `types.ts`(index → sentenceId) → `features/report/` · `components/ReportViews.tsx`·`parts.tsx`는 05·06 화면 참고용 | `lib/sessions.ts`, `/api/report/{sessions,health,reports}`, `ReportStudio.tsx`, `scripts/`, `tests/` |
| fixtures | `presentation.pdf`, `proposal.pdf` → `app/public/samples/`("샘플 자료 사용") · `sample-session.json`, `lib/session.ts`(`SessionRecordSchema`) → `app` 테스트 | `src/`, `scripts/`, `components/`, `audio/`(PoC 검증 전용으로 `pocs/`에 유지) |
