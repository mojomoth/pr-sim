# PoC: STT / TTS (`pocs/stt-tts`)

> 요구사항: "gemini api 를 이용해서 STT 와 TTS 동작 확인 · 문장별로 전사되어 나타나고 입력된 페르소나 (남자, 연령, 친절함, 빡셈, 공격적) 에 다른 음성 생성"

**확인 URL:** http://localhost:3100/stt-tts (모바일 390px 우선, 데스크톱 2열)

| 기능 | 결과 |
|---|---|
| STT: 마이크 → 문장마다 말풍선 (`음성 인식 중` → `인식 완료` + 타임스탬프) | ✅ Live 스트리밍(A) 채택, 확정 지연 **1.4–1.7초** (B는 2.5–3.0초) |
| 쉼(pause)을 사이에 둔 한 문장 → 말풍선 하나로 병합 | ✅ "저희 서비스는 … (1.4초 쉼) … 만들어 줍니다." → 1개 |
| TTS: 성별·연령·성향 → 서로 다른 음성 + 말투 | ✅ 12조합 = 12개 음성, Live 왕복 전사 정확도 **99.8%** |
| 3가지 성향 비교 버튼 | ✅ 같은 문장을 친절함 → 빡셈 → 공격적 순서로 생성·재생 |
| 마이크 권한 거부 / API 오류 / 쿼터 초과 UI | ✅ 오류 문구 + 다시 시도, 자동 모드에서 B로 폴백 |

---

## 1. Architecture & data flow

```
                       ┌────────────── (A) Live 스트리밍 — 채택 ───────────────┐
Mic ─ getUserMedia ─ AudioWorklet(public/stt-tts/pcm16k-worklet.js)            │
     48kHz → LPF + resample → 16kHz Float32, 20ms 프레임                       │
        │                                                                      │
        ├─ EnergyVad (client/vad.ts): 레벨 미터, 발화 종료 시각(지연 측정)      │
        │                                                                      │
        ├─(A) POST /api/stt-tts/token → 1회용 에페메랄 토큰(30분, 모델·설정 잠금)│
        │     브라우저 → wss Gemini Live (gemini-3.5-transcribe-live,          │
        │     BidiGenerateContentConstrained, 100ms PCM16 청크)                │
        │     ← interimInputTranscription (말하는 중 누적 텍스트)              │
        │     ← inputTranscription (서버 VAD가 쉼을 감지하면 확정 텍스트)      │
        │                                                                      │
        └─(B) VAD 0.6초 침묵(최대 15초)마다 구간 → 16kHz WAV                   │
              POST /api/stt-tts/transcribe → gemini-3.5-transcribe             │
              (generateContent, parts[].audioTranscription.text) → JSON        │
                                                                               │
  SentenceAssembler (lib/sentences.ts) ◀── 확정 텍스트 청크 ───────────────────┘
     · 다./요./까?/!/… 로 문장 분리 (3.5배, A.I., "…" 라고 등 예외)
     · 끝나지 않은 꼬리는 carry → 다음 청크와 합쳐 한 문장으로
     · 문장부호가 없으면 종결어미(습니다/어요/까요/죠…)로 판단, 2.5초 무음 시 강제 확정
     · 한 글자 어미 다/요/까는 앞 음절로 판단(봐요·돼요 O / 중요·필요·수요·주요 X, 했다·있다 O / 보다·바다 X, 할까 O)
     · 청크 경계 이어붙이기(joinChunks): "3." + "5배" → "3.5배", "A." + "I." → "A.I.", "중요" + "합니다" → "중요합니다", "수요" + "가 …" → "수요가 …"
  → sentences: TranscriptSentence[] (t = 시작 후 초, phase)

TTS form ─ POST /api/stt-tts/tts {text, gender, age, temperament}
  → persona.ts: (성별 × 성향 × 연령대) → 프리빌트 음성 12종 + 연령/성향 스타일 지시문
  → .data/stt-tts/tts/<sha256(voice,style,text)>.wav 캐시 확인
  → gemini-3.8-flash-tts (429/5xx/타임아웃/길이 이상 시 다음 모델) → WAV(24kHz mono s16)
  → audio/wav + 헤더 x-voice, x-style, x-model, x-cache, x-duration, x-ms
```

### A vs B 비교 (실측, headless Chrome + 가짜 마이크, 같은 4문장 25초 음성)

| | (A) Live 스트리밍 | (B) VAD + transcribe |
|---|---|---|
| 확정 지연 (실제 발화 끝 → 말풍선 확정) | **1.4–1.7초 (평균 1.5)** | 2.5–3.0초 (평균 2.6) |
| 말하는 중 텍스트 | ✅ 약 0.5초 간격 interim | ✗ (`말하는 중…`/`전사 중…` 표시만) |
| 서버 경유 | 토큰 발급만 (0.31–0.35초) | 매 구간 업로드 |
| 요청 수 / 무료 쿼터 | 세션 1개(별도 한도, 오늘 계속 동작) | 구간마다 1회 → **gemini-3.5-transcribe 하루 25회** 금방 소진 |
| 전사 품질 | 7/7 문장 정확 | 7/7 문장 정확 |
| 위험 | Live API·에페메랄 토큰이 experimental(v1alpha) | 쿼터, 지연 |

→ **기본값 `자동` = A를 쓰고, 토큰/연결 실패 시 B로 자동 전환.** UI에서 A/B를 강제로 골라 비교할 수 있다.

## 2. Models (and why)

| 용도 | 모델 | 이유 / 비고 |
|---|---|---|
| 실시간 STT (A) | `gemini-3.5-transcribe-live` | `bidiGenerateContent` 전용. `inputAudioTranscription.languageCodes=["ko-KR"]`, 서버 VAD가 쉼마다 확정. |
| 구간 STT (B) / 서버 재사용 | `gemini-3.5-transcribe` → 폴백 `gemini-3.8-flash` | `audioTranscriptionConfig.languageCodes=["ko-KR"]`. 25초 음성 1.9초. 결과는 `parts[].audioTranscription.text`. |
| TTS | `gemini-3.8-flash-tts` → `gemini-3.8-flash-lite-tts` → `gemini-3.1-flash-tts-preview` → `gemini-2.5-flash-preview-tts` | 무료 티어가 **모델별 하루 10회·분당 3회**라 4개 모델 체인(각자 별도 버킷). 3.8 계열은 WAV, 나머지는 `audio/L16;rate=24000` PCM → WAV로 감쌈. |

SDK 주의점(@google/genai 3.1):
- 기본 API 버전이 `/v1`이고 여기서는 `speechConfig`가 거부된다(`Unknown name "speechConfig"`). 요청마다 `httpOptions: { apiVersion: "v1beta", timeout: 45000 }`.
- 에페메랄 토큰은 `ai.authTokens.create({ config: { httpOptions: { apiVersion: "v1alpha" }, uses: 1, expireTime, newSessionExpireTime, liveConnectConstraints: { model, config } } })`. 브라우저는 `new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion: "v1alpha" } })` 로 연결(SDK가 `access_token` + `BidiGenerateContentConstrained` 사용). API 키는 클라이언트로 가지 않는다.

### 페르소나 → 음성 매핑 (`lib/persona.ts`)

| | 친절함 (20–39 / 40–70) | 빡셈 | 공격적 |
|---|---|---|---|
| 남자 | Achird (Friendly) / Sadaltager (Knowledgeable) | Iapetus (Clear) / Schedar (Even) | Fenrir (Excitable) / Algenib (Gravelly) |
| 여자 | Sulafat (Warm) / Vindemiatrix (Gentle) | Erinome (Clear) / Gacrux (Mature) | Kore (Firm) / Pulcherrima (Forward) |

- 연령 → 음색·속도 지시 (1세 단위, `ageStyle()`): 정확한 나이(`a 33-year-old Korean woman`) + 약 8세 단위 음색/음높이(≤27 "youthful, slightly higher pitch" · ≤34 "mid-high" · ≤44 "natural mid" · ≤54 "slightly lower mid" · ≤62 "seasoned, lower" · 63+ "deep, low, weathered") + 말 속도 오프셋(20세 "about 13% quicker" → 45세 "average" → 70세 "about 12% slower"). 프리빌트 음성 자체는 40세에서 바뀌므로(위 표) 대역 안의 나이 차이는 이 지시로만 만들어진다 — UI 연령 슬라이더 아래에 `음성: 20–39세 X · 40–70세 Y`로 경계를 표시.
- 성향 → 말투 지시: 친절함 "warm, gentle, moderate pace" · 빡셈 "crisp, dry, precise, slightly fast" · 공격적 "pressing, firm, sharp emphasis — professional, no shouting".
- 프롬프트는 Gemini 가이드의 **director's notes** 형식(`# AUDIO PROFILE … ### DIRECTOR'S NOTES … #### TRANSCRIPT`). 처음 쓴 평범한 "Style: … TEXT: …" 형식에서는 lite 모델이 **지시문을 소리 내어 읽음**(32초짜리 오디오) → 형식을 바꾸고, 출력 길이가 `3 + 0.3초×글자수`를 넘으면 버리고 다음 모델로 넘어가게 했다(캐시 읽을 때도 같은 검사).

## 3. Routes / APIs

| Route | 설명 |
|---|---|
| `GET /stt-tts` | PoC 화면 (STT 패널 + TTS 패널) |
| `POST /api/stt-tts/token` | → `{ token, model, expiresAt, config }` 1회용 Live 토큰. **엄격한 출처 검사**: `sec-fetch-site: same-origin` 또는 (Fetch-Metadata 없는 브라우저) `Origin` == Host 일 때만 발급 — 헤더 없는 curl/스크립트·교차 사이트·`sec-fetch-site: none`은 403. 클라이언트당 분당 10회 |
| `POST /api/stt-tts/transcribe` | body: 오디오 원본(`audio/wav` 등) 또는 multipart `audio` → `{ text, sentences[], model, ms }` (20MB 제한) |
| `POST /api/stt-tts/tts` | `{ text(1–1200자), gender: "male"|"female", age: 20–70, temperament: "friendly"|"strict"|"aggressive" }` → `audio/wav` + `x-voice`, `x-style`(URI 인코딩), `x-model`, `x-cache: HIT|MISS`, `x-duration`, `x-ms` |

오류는 `{ error: "<한국어 메시지>", status, retryAfterSec? }` (429는 `retry-after` 헤더 포함). 400 입력 오류는 zod issue 포함.
transcribe/tts는 교차 사이트만 403(헤더 없는 서버 간 호출 허용). 세 라우트 모두 클라이언트(IP)별 분당 제한(token 10 / transcribe 40 / tts 30, 메모리 고정 창, `lib/http.ts` `RATE_LIMITS`) → 초과 시 429 `{ local: true }`.
전사는 **시간 예산** `10초 + 음성 길이×0.6초`(최대 120초) 안에서만 모델 폴백, 429 쿨다운 대기 없음 → 한도 소진 시 1초 안에 429, 시간 초과는 504 "응답 시간 초과".

## 4. Reusable lib API (실제 앱 / question PoC에서 import)

```ts
// 서버 (server-only)
import { transcribeAudio, synthesizeSpeech, mintLiveToken } from "@/stt-tts/lib/server";
transcribeAudio(buf: Buffer, mime: string, opts?: { budgetMs?: number }): Promise<{ text: string; sentences: string[]; model?: string; ms?: number }>
synthesizeSpeech(text: string, p: { gender: "male"|"female"; age: number; temperament: Temperament })
  : Promise<{ wav: Buffer; voice: string; style: string; model?: string; cached?: boolean; durationSec?: number; ms?: number }>
mintLiveToken(): Promise<{ token: string; model: string; expiresAt: string; config }>

// 클라이언트
import { useSentenceTranscriber } from "@/stt-tts/client/useSentenceTranscriber";
const t = useSentenceTranscriber({ mode: "auto" | "live" | "chunked", phase: "presentation" | "qa", onSentence? });
t.start(); t.stop(); t.reset();
t.sentences   // LiveSentence[] (TranscriptSentence + id, latencyMs?, source) — 확정 문장
t.partial     // 인식 중인 텍스트, t.partialSentences: string[] (문장별 "음성 인식 중" 말풍선)
t.status      // "idle" | "connecting" | "listening" | "stopping" | "error"
t.error / t.notice / t.level (0–1) / t.speaking / t.inProgress / t.activeMode
t.failures    // SegmentFailure[] { id, t, message, status? } — (B) 전사 실패 구간 (UI에서 빨간 말풍선)
t.warning     // 듣는 중이지만 실패 구간이 있을 때의 경고 문구 (성공하면 null)
// 옵션: transcribeTimeoutMs(25000), maxFailStreak(3) — 일일 한도 소진(429, retryAfter>1h) 또는 연속 3회 실패 시 자동 중단 + t.error

import { playWav, fetchTts, stopAll } from "@/stt-tts/client/playWav";
const clip = await fetchTts({ text, gender, age, temperament }); // { blob, voice, style, model, cached, durationSec, totalMs }
await playWav(clip.blob).done;

// 공용(서버·브라우저)
import { SentenceAssembler, splitSentences, toSentences, joinChunks, looksFinished } from "@/stt-tts/lib/sentences";
import { resolveVoice, styleFor, ageStyle, SAMPLE_QUESTIONS, VOICE_TABLE } from "@/stt-tts/lib/persona";
```

심사 단계에서 쓰려면: 질문 텍스트 → `synthesizeSpeech(question, judge)` (judge의 gender/age/temperament) → 재생 후 `useSentenceTranscriber({ phase: "qa" })`로 답변 전사. `JudgePersona.gender/age`가 없으면 기본값을 정해 넣어야 한다.

## 5. HIL 체크리스트 (사람이 직접 확인)

1. `/stt-tts` 접속 → `마이크 켜고 전사 시작` → 브라우저 마이크 권한 허용.
2. 한국어로 2–3문장을 **문장 사이에 1초씩 쉬며** 말하기 → 말하는 동안 점선 말풍선에 글자가 실시간으로 바뀌고(`음성 인식 중`), 쉬고 나서 약 1.5초 안에 문장마다 회색 말풍선(`인식 완료 · 00:05 · 지연 1.5초`)이 **따로** 생기는지.
3. 한 문장을 **중간에 쉬면서** 말하기 ("저희 서비스는 … 발표 연습을 돕습니다.") → 말풍선 하나로 합쳐지는지.
4. 숫자·영문 섞기 ("매출이 3.5배 늘었습니다", "A.I. 기술") → 엉뚱하게 잘리지 않는지. "이 부분이 정말 **중요**(쉼)합니다", "가장 **필요**(쉼)한 것은…"처럼 명사 뒤에서 쉬어도 말풍선이 둘로 갈라지지 않는지.
5. `전사 종료` → 말하던 마지막 문장이 확정되는지. `지우기` 동작.
6. `VAD (B)` 모드로 바꿔 비교 → 중간 글자 없이 2–3초 뒤 문장이 뜨는지. 전사가 실패하면 **빨간 "이 구간을 전사하지 못했습니다" 말풍선 + 빨간 경고 + 상태 배지 "듣는 중 · 전사 실패"**가 보이고, 일일 한도 소진이면 첫 실패에서, 그 외 오류는 3회 연속 실패 시 **자동으로 전사를 멈추고 "오류" + 다시 시도**가 뜨는지(한도 소진 시 1초 안에 표시).
7. 브라우저에서 마이크 권한을 **차단**한 뒤 시작 → 빨간 안내 + `다시 시도`.
8. TTS: 남자/여자 × 20대/60대 × 친절함/빡셈/공격적을 바꿔 가며 `음성 생성` → 화면의 음성 이름·스타일 프롬프트가 바뀌는지, **귀로 듣기에 성별·나이·말투 차이가 느껴지는지**. 특히 **같은 음성 대역 안**(예: 여자·빡셈 25세 vs 35세 — 둘 다 Erinome)에서 나이 차이가 들리는지, 39→40세에서 음성이 바뀌는 게 어색하지 않은지(슬라이더 아래 경계 표시 확인).
9. `3가지 성향 비교` → 같은 문장을 친절함 → 빡셈 → 공격적 순서로 재생. 공격적도 무례하지 않고 "프로답게 압박"하는지.
10. 같은 조건으로 다시 생성 → `캐시`로 즉시 재생되는지. 연속으로 여러 번 누르면 한도 안내 문구가 나오는지.

> ⚠️ 무료 티어 한도 (오늘 2026-11-12 기준 실측): TTS 모델별 **10회/일·3회/분**, `gemini-3.5-transcribe` **25회/일**, `gemini-3.8-flash` **20회/일**. 검증 중 `gemini-3.8-flash-tts`, transcribe, flash는 오늘 소진(약 18시간 후 리셋). Live STT와 TTS 폴백 모델(3.1-flash-tts-preview, 2.5-flash-preview-tts)은 일부 남아 있다. 리뷰 1차 수정에서 연령 스타일 문구가 바뀌어 기존 캐시는 더 이상 맞지 않는다. 기본 화면(남자·58세)의 3성향 샘플 문장은 수정 후 다시 생성해 캐시해 두었다(Schedar 7.7초 / Sadaltager 7.3초 / Algenib 8.2초, 생성 5.5–21.9초, 2.5-flash-preview-tts). 그 외 조합의 첫 생성은 쿼터를 쓴다.

## 6. Verification evidence

모든 명령은 `pocs/`에서 실행. 스크린샷·JSON은 `pocs/.verify/stt-tts/`.

| 검증 | 명령 | 결과 |
|---|---|---|
| 타입/린트 | `pnpm exec tsc --noEmit \| grep stt-tts` · `pnpm exec eslint stt-tts app/stt-tts app/api/stt-tts` | 0 오류 |
| 문장 분리 단위 테스트 | `node --test stt-tts/tests/sentences.test.mjs` | 12/12 통과 (리뷰 수정 후, 아래 표 참고) — 최초 8/8 통과 (다./요./까?, 3.5배, A.I., 인용 "…" 라고, 닫는 따옴표, 무문장부호 종결어미, carry 병합, preview) |
| Live(A) 브라우저 | `node stt-tts/tests/stt-browser.mjs live 32` | 가짜 마이크(4문장, 1.3초 쉼) → **확정 말풍선 7개**(25초 반복 재생 포함), 지연 1.4–1.7초, 콘솔 오류 0 — `stt-live-partial.png`, `stt-live-done.png`, `stt-live.json` |
| 자동 모드 | `node stt-tts/tests/stt-browser.mjs auto 34` | 엔진 = Live, 8문장 — `stt-auto-*.png` |
| VAD+전사(B) 브라우저 | `node stt-tts/tests/stt-browser.mjs chunked 32` | 7문장, 지연 2.5–3.0초 — `stt-chunked-*.png` |
| 쉼을 낀 한 문장 병합 | `WAV=stt-tts/tests/fixtures/split-sentence-16k.wav TAG=split node stt-tts/tests/stt-browser.mjs live 13` | "저희 서비스는 발표 연습을 실전처럼 만들어 줍니다." **1개 말풍선** — `stt-live-split.json` |
| 오류 경로 | `node stt-tts/tests/stt-errors.mjs` | 마이크 거부 → "마이크 권한이 거부되었습니다…" + 다시 시도; 토큰 실패(자동) → VAD+전사로 전환, 전사 쿼터 오류는 notice로 표시; 토큰 실패(Live 강제) → "Live 연결 실패: …" — `err-*.png`, `stt-errors.json` |
| TTS 12조합 | `node stt-tts/tests/tts-matrix.mjs` | 12/12 성공, **서로 다른 음성 12종**, 새로 생성 2.8–7.3초(lite 2.8–4.2, 3.1-preview 6.2–7.3, 3.8 3.9), 캐시 HIT 7–34ms — `tts-matrix.json`, `wav/*.wav` |
| TTS→STT 왕복 | `node stt-tts/tests/roundtrip-live.mjs` | 글자 정확도 평균 **99.8%** (11개 100%, Algenib 97.3% "서비스를→서비스와"). 배치 전사(gemini-3.5-transcribe)로도 5개 100% |
| 음성 차이 정량화 | `node stt-tts/tests/voice-stats.mjs` | 중앙값 F0: 여28 208–232Hz, 여58 163–186Hz, 남58 110–172Hz / 말 속도: 빡셈 7.9–8.5자/초 vs 친절함(시니어) 5.8–6.4자/초 — `voice-stats.json` |
| TTS UI | `node stt-tts/tests/tts-browser.mjs mobile` · `desktop` | 해석된 음성/스타일 표시, 생성(캐시) + 3성향 비교 3클립, 오류 0 — `tts-mobile.png`, `tts-mobile-clips.png`, `tts-desktop.png` |
| API 실측 | curl | token 0.31–0.35초, transcribe(25초 음성) 1.9초, tts 캐시 16ms, 빈 텍스트 400, 교차 사이트 403, 쿼터 소진 시 429 + `retryAfterSec` |

### 리뷰 1차 수정 검증 (2026-11-12)

| 지적 | 수정 | 검증 명령 / 결과 |
|---|---|---|
| 요/다 명사(중요·필요·수요·주요)·"3."+"5배"·"A."+"I."에서 말풍선 분리 | `looksFinished()`: 한 글자 어미 다/요/까는 앞 음절(받침·모음)로 판단 + 명사 목록; 끝의 `숫자.`/`A.`는 미완료로 carry; `joinChunks()`로 청크 경계 무공백 결합 | `node --test stt-tts/tests/sentences.test.mjs` **12/12** (신규 4: 명사 6케이스, 소수/약어 3케이스, 진짜 종결 11개 vs 비종결 11개, 띄어쓰기 유지). 리뷰어 스크립트 8케이스 모두 1문장. Live 회귀 `TAG=fix-live node stt-tts/tests/stt-browser.mjs live 32` → 7문장, 평균 지연 1.4초; `TAG=fix-split …split-sentence-16k.wav … live 13` → 쉼 낀 문장 1개 말풍선 유지 |
| B 모드 전사 실패가 회색 notice뿐, `듣는 중` 유지, 502까지 46초 | 실패 구간 = 빨간 말풍선(`segment-failed`) + `role=alert` 경고 + 배지 "듣는 중 · 전사 실패"; 일일 한도 소진/3회 연속 실패 시 전사 중단·오류; 서버 전사 시간 예산 + 쿨다운 대기 제거, 클라이언트 25초 타임아웃 | `node stt-tts/tests/fix-failures.mjs`(transcribe 응답 모킹): 첫 구간 502 → 경고·실패 말풍선 후 다음 구간 성공 시 경고 해제, 문장 2개; 전부 502 → 3회 후 상태 "오류" + "구간 전사가 3번 연속 실패해 전사를 중단했습니다" — `.verify/stt-tts/fix/*.png`, `fix-failures.json`. 실제 한도 소진 상태: `TAG=fix-chunked-quota node stt-tts/tests/review-stt.mjs chunked 30` → 첫 구간에서 "전사를 중단했습니다: 오늘 Gemini 전사 무료 사용량…" (`.verify/stt-tts/review/fix-chunked-quota-done.png`). curl `/transcribe` 429 응답 **46초 → 1.0초**(이후 4ms) |
| 헤더 없는 curl로 Live 토큰 발급 | 토큰만 엄격 출처 검사 + 전 라우트 분당 제한 | curl: 헤더 없음 403 · `sec-fetch-site: cross-site` 403 · `none` 403 · `Origin: evil` 403 · `same-origin` 200(0.55초) · `Origin: http://localhost:3100` 200(0.35초). 11번째 요청 429 `retry-after: 54`. 브라우저 Live 경로는 그대로 동작(위 Live 회귀) |
| 연령이 2단계(40세 경계)로만 음성에 반영 | 스타일 지시를 1세 단위(정확한 나이·음높이 6단계·속도 ±13%)로, UI에 음성 경계 표시 | 여자·빡셈 25세 vs 35세 실제 생성: 둘 다 Erinome, 3.76초 vs 4.21초(같은 문장, 단 폴백 모델이 3.1-preview / 2.5-preview로 달라 비교에 잡음) — `.verify/stt-tts/fix/tts-female-strict-{25,35}.wav`. **청감 비교는 HIL 필요** |

### 검증 중 발견한 것 (중요)
- **공용 `scripts/browser.mjs`의 `fakeAudioWav`는 macOS에서 무음**: 샌드박스된 오디오 서비스가 WAV 파일을 못 읽음(피크 0). `--disable-features=AudioServiceSandbox` 추가 시 정상(피크 0.55). 이 PoC는 `stt-tts/tests/launch.mjs`(동일 + 플래그)를 사용. ffmpeg WAV의 `LIST` 청크도 제거(`-map_metadata -1 -fflags +bitexact`).
- `@google/genai` v3의 기본 `/v1` 경로에서 TTS가 400 → `v1beta` 필요.
- 서버는 transcribe 결과에서 `ko-KR` 힌트 때문에 영어 발화(지시문 낭독)를 **누락**한다 → 왕복 정확도만으로는 "지시문 낭독" 버그를 못 잡음, 길이 검사로 보완.

## 7. Known limitations

- 무료 티어 한도가 매우 작음(위 표). 실제 서비스는 유료 키 또는 Live(A) 위주가 필수. B는 구간마다 요청이라 비현실적.
- 출처 검사는 헤더 기반이라 브라우저가 아닌 클라이언트는 `Origin`을 위조해 토큰을 받을 수 있다. 분당 제한(메모리, IP 단위 — 로컬 개발에서는 모든 요청이 `local` 한 키)이 남용 속도만 막는다. **실제 앱은 로그인 세션 인증 + 사용자별 쿼터 필수.**
- 문장 분리 휴리스틱: 명사 목록(중요·필요·수요·주요·개요·소요·강요·보다·바다·마다)에 없는 요/다-명사는 여전히 갈라질 수 있고, 반대로 "크다/나쁘다"처럼 받침 없는 음절 + 다 로 끝나는 무문장부호 문장은 2.5초 무음 후에야 확정된다(Live는 보통 문장부호를 붙여 줘서 실제로는 드묾). 끝이 "3."/"A."인 청크는 다음 청크나 2.5초 무음까지 대기.
- 연령: 프리빌트 음성은 여전히 성별×성향마다 2개(20–39 / 40–70)이고 대역 내 나이 차이는 스타일 지시에만 의존 — 모델(특히 폴백 모델)이 지시를 얼마나 반영하는지는 청감 확인 필요. 스타일 문구가 바뀌어 **이전 TTS 캐시(남자 58세 3성향, 12조합)는 무효화**됨 → 첫 재생 시 다시 생성(쿼터 사용).
- 3회 연속 실패 기준·25초 타임아웃은 경험값. 분당 한도(429, 짧은 retryAfter)는 실패 말풍선만 남기고 계속 듣는다.
- Live API·에페메랄 토큰은 SDK에서 experimental(`v1alpha`). Live 세션은 서버가 끊으면(약 10–15분 한도, goAway) 새 토큰으로 자동 재연결(최대 5회) — 재연결 순간 0.x초 오디오가 버퍼링/누락될 수 있음. 30분 발표 장시간 테스트는 아직 안 함.
- 문장 타임스탬프 `t`는 interim이 처음 보인 시각 −1초 근사(±1초).
- 확정 지연은 로컬 에너지 VAD 기준이며 시끄러운 환경에서는 측정값이 부정확할 수 있음(전사 자체는 서버 VAD).
- 쿨다운(429 대기) 상태는 서버 메모리라 개발 서버 HMR/재시작 시 초기화 → 첫 요청이 다시 429를 맞고 다음 모델로 넘어감(동작에는 문제 없음).
- 음성 차이는 F0/속도로만 정량화했고 "나이·성향이 자연스럽게 들리는지"는 사람 판단(HIL) 필요. 폴백 모델(lite/3.1/2.5)마다 음색이 조금씩 다름.
- 마이크 echoCancellation을 켜 두었으므로 TTS 재생과 STT를 동시에 쓰면 스피커 소리가 일부 걸러지거나 섞일 수 있음(심사 단계에서는 재생 중 전사 일시정지 권장).
- iOS Safari 실기기 미검증(AudioWorklet·autoplay 정책).

## 8. Next steps

1. 심사(Q&A) 화면 연결: `question` PoC 질문 → `synthesizeSpeech` → 재생 끝나면 `useSentenceTranscriber({ phase: "qa" })` 시작, 재생 중에는 mic mute.
2. 장시간(30분+) Live 세션: `sessionResumption` 핸들로 재연결 시 문맥 유지, goAway 직전 선제 재연결 테스트.
3. 유료 키 또는 Vertex로 전환해 쿼터 제거, TTS 결과는 질문 생성 직후 미리 합성(prefetch)해 체감 지연 0초.
4. 발표 용어 정확도: `customVocabulary`(AudioTranscriptionConfig)에 발표자료 위키의 고유명사 주입.
5. 공용 `scripts/browser.mjs`에 `--disable-features=AudioServiceSandbox` 반영(오케스트레이터 몫).
