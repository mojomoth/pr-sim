# PR-SIM v1 — 기술 검증·결정 기록

기준일 2026-11-13. 원자료: `pocs/.verify/g0/bench/` (스크립트 `bench-openai.mjs`·`bench-followup.mjs`, 응답 원본 `raw/*.json`, 플랫폼 점검 `raw/platform-check.txt`).

## 1. 기술 검증 결과

### 1-1. LLM — 질문 생성
조건: OpenAI Responses API, Structured Outputs(`json_schema` strict), 스트리밍. 프롬프트는 `pocs/question`의 공통 규칙과 "빡셈" 페르소나를 그대로 사용했습니다. 자료는 덱 p.6·8·9 원문과 전사 20문장이며, 2문항을 만들고 각 문항은 슬라이드 쪽을 인용합니다. 검사 항목은 스키마, 문항 수, 120자, 인용 원문 일치, 쪽 번호입니다.

| 모델 | effort | 전체(초) r1/r2 | 첫 토큰(초) | 검사 | 한국어 | 비고 |
|---|---|---|---|---|---|---|
| gpt-6.1-terra | low | 6.1 / 6.3 | 2.5 / 2.6 | 2/2 통과 | 상 | 2문항째가 덜 날카로움 |
| gpt-6.1-terra | none | 7.3 / 5.2 | 2.5 / 1.6 | 2/2 통과 | 상 | 148원 기준 이익률 약 20% 계산 정확 |
| gpt-5.5 | low | 7.1 / 7.6 | 3.9 / 3.7 | 2/2 통과 | 상 | 현재 PoC 기본값 |
| gpt-5.5 | none | 4.9 / 4.9 | 1.2 / 1.9 | 1/2 (인용 doc 표기 오류 1건) | 상 | 가장 빠름 |
| gpt-6.1-sol | low | 11.3 / 6.4 | 6.1 / 2.2 | 2/2 통과 | 상 | 편차 큼 |
| gpt-6-astra | low | 8.7 / 9.5 | 2.2 / 3.1 | 2/2 통과 | 상 | 출력 속도 느림 |
| gpt-5.4-mini | low | 6.8 / 6.6 | 4.4 / 3.9 | 1/2 | 중 | "6,800억"을 "680억"으로 환각, 인용 쪽 오류 |

- `none` effort는 gpt-6.1-sol과 gpt-6-astra에서 400 unsupported입니다(지원: low·medium·high·xhigh·max).

### 1-2. LLM — 꼬리질문 판정 (각 2회, 회피성 답변 QA #2, 기대 판정은 회피 또는 부분)
| 모델 | effort | 전체(초) | 첫 토큰(초) | 판정 | 품질 |
|---|---|---|---|---|---|
| gpt-5.5 | low | 3.4 / 3.0 | 1.0 / 0.9 | 부분·부분 | 정확한 꼬리질문 |
| gpt-5.5 | none | 3.8 / 3.6 | 1.5 / 1.1 | 부분·부분 | 양호 |
| gpt-6.1-terra | low | 3.5 / 3.7 | 1.1 / 1.4 | 부분·부분 | 양호 |
| gpt-6.1-sol | low | 5.4 / 4.6 | 2.1 / 1.7 | 회피·부분 | 최상 |
| gpt-6-astra | low | 8.2 / 5.9 | 4.5 / 2.7 | 회피·회피 | 최상, 느림 |
| gpt-5.4-mini | none/low | 2.0–2.9 | 0.8–1.5 | 1회 "부정확" 오판정 | 중 |

### 1-3. LLM — 평가 JSON (effort medium, 1회; 기대값 weak/evasive, 정확도 59 이하, 142원 언급)
| 모델 | 시간(초) | verdict | 정확도 | 근거 충실도 | 비고 |
|---|---|---|---|---|---|
| gpt-6-astra | 28.3 | evasive | 45 | 최상 | 118원·142원 이익률(28.5%·13.9%)을 계산해 정정 계획 제시 |
| gpt-6.1-sol | 20.0 | evasive | 43 | 상 | 142원을 단정하지 않음 |
| gpt-6.1-terra | 15.0 | evasive | 40 | 상 | 간결함 |
| gpt-5.5 | 15.0 | weak | 55 | 중 | 142원을 근거 없이 "오류"로 단정 |
| gpt-5.4-mini | 6.5 | weak | 38 | 하 | 관대한 점수, "초안 수치"를 지어냄 |

비용: gpt-6.x 공개 단가는 확인하지 못했습니다. 토큰은 질문 입력 약 2.0k·출력 0.3–0.9k, 평가 입력 약 1.8k·출력 0.9–1.1k입니다.

### 1-4. TTS·STT
| 항목 | 결과 |
|---|---|
| Gemini TTS (PoC `/api/stt-tts/tts`, 1문장) | 200, 2.9초, 음성 5.8초, `x-model: gemini-3.8-flash-lite-tts`. 1순위 `gemini-3.8-flash-tts`는 건너뜀(11-12 일일 한도 소진 이후 메모리 쿨다운으로 추정) |
| OpenAI TTS 모델 | `gpt-4o-mini-tts`(최신 2025-12-15), `tts-1`, `tts-1-hd`. 더 새로운 TTS 모델 없음 |
| `gpt-4o-mini-tts` 1회 | 200, 2.6초(첫 바이트 1.4초), 음성 6.8초, WAV 24kHz, `instructions`로 페르소나 지정 가능 |
| STT 토큰 `/api/stt-tts/token` | 같은 출처 헤더로 200(0.29초), `gemini-3.5-transcribe-live`, 30분 만료, 값 비공개. 헤더 없으면 403 |

### 1-5. 배포 플랫폼
| 항목 | 결과 | v1 영향 |
|---|---|---|
| Vercel 플랜 | Hobby(개인 팀 1개, OWNER), 동시 빌드 1 | 상업적 사용 불가 약관, 시연용 |
| 함수 실행 시간 | 기존 Next 프로젝트: fluid=true, timeout 300초 | `maxDuration` 300초 이하 |
| 기본 리전 | iad1 | `icn1`로 변경 권장 |
| 요청 본문 | 4.5MB | 페이지 텍스트만 전송 |
| 파일시스템 | 읽기 전용, `/tmp`만 휘발성 쓰기 | PoC 디스크 캐시는 v1 서버에서 쓰지 않음 → IndexedDB |
| pr-sim 프로젝트 | 없음(21개 중) | G3에서 생성(Root=`app`) |
| Render API | `GET /v1/owners` 200 | 접근 확인만 함 |
| `JEV_KEY` | 접두사 `apik…`, 용도 미상 | 사용 안 함 |

## 2. 결정
| # | 결정 | 이유 |
|---|---|---|
| D1 | 질문 = `gpt-6.1-terra`(low), 폴백 `gpt-5.5`(none) | 4/4 검사 통과, 6초대·첫 토큰 2.5초로 안정적 |
| D2 | 꼬리질문 = `gpt-5.5`(low), 폴백 `gpt-6.1-terra`(low) | 3초·첫 토큰 1초로 최속, 품질 양호 |
| D3 | 리포트 = `gpt-6-astra`(medium), 폴백 `gpt-6.1-sol`(medium) → `gpt-5.5` | 근거·계산 정확도 최고, 28초는 300초 한도 안 |
| D4 | 위키 빌드 = `gpt-6.1-terra`(low), 개요 = `gpt-6.1-sol`(low) | 수치 정확도 우선, `gpt-5.4-mini`는 환각해 제외 |
| D5 | `gpt-5.4-mini`·`gpt-5.4-nano`는 수치 단계에 쓰지 않음 | 환각·오판정 |
| D6 | 제공자 순서 OpenAI → Gemini(최후) → Claude(12-01 이후) | Claude 한도 초과. PoC의 Claude 우선 순서는 쓰지 않음 |
| D7 | TTS 체인 `gemini-3.8-flash-tts` → `gemini-3.8-flash-lite-tts` → OpenAI `gpt-4o-mini-tts` | Gemini 기본 유지, OpenAI는 속도가 비슷하고 페르소나 지시 지원. 미리보기 모델 제외 |
| D8 | TTS 폴백은 즉시 전환(쿨다운 대기 없음). 세션 안에서 OpenAI로 넘어가면 세션 끝까지 고정 | 대기 없이 바로 재생, 목소리 일관성 |
| D9 | STT = Gemini Live + 에페메랄 토큰 유지 | 0.3초 발급, 키가 브라우저로 나가지 않음 |
| D10 | Vercel 리전 `icn1`, `maxDuration` 명시(질문 60초·리포트 300초) | 한국 사용자 지연 감소, Hobby 상한 준수 |

## 3. 미해결 문제
| # | 문제 | 영향 | 대응 |
|---|---|---|---|
| U1 | Gemini 무료 일일 한도(TTS 모델별 10회/일·3회/분, flash 20회/일, transcribe 25회/일) | 세션 하나에 TTS 6–10회 → 하루 2–3세션이면 소진 | 실사용 전 Gemini 유료 등급 필요. 그 전까지는 D7·D8과 클라이언트 TTS 캐시로 버팀 |
| U2 | Live STT 무료 한도 수치 미확인 | 전사 중단 위험 | G1에서 확인. 폴백 후보 `gpt-realtime-whisper`·`gpt-4o-mini-transcribe`(미검증) |
| U3 | 표본 작음(모델당 2회) | 순위가 바뀔 수 있음 | G2에서 재측정, 모델 id는 환경변수로 |
| U4 | 58쪽 제안서 전체로 위키 빌드를 측정하지 않음 | D4 근거 부족 | G1 wiki PoC에서 검증 |
| U5 | gpt-6.x 단가 미확인 | 비용 추정 불가 | 대시보드에서 확인 |
| U6 | Vercel Hobby 상업적 사용 불가 | 공개 전환 시 문제 | 전환 시 Pro |
| U7 | `JEV_KEY` 용도 미상 | — | 확인 전까지 사용 안 함 |
| U8 | PoC TTS 쿨다운이 서버 메모리에 남아 리셋 뒤에도 1순위를 건너뜀 | 오늘 1순위 건너뜀의 추정 원인 | v1은 쿨다운을 분 단위로 짧게 둠 |
