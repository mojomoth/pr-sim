# PR-SIM v1 — 기술 검증·결정 기록

기준일 2026-11-13. 1–3절은 G0, 4–7절은 G2·G3 기록입니다. G0 원자료: `pocs/.verify/g0/bench/` (스크립트 `bench-openai.mjs`·`bench-followup.mjs`, 응답 원본 `raw/*.json`, 플랫폼 점검 `raw/platform-check.txt`).

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

## 4. G2 통합 검증 (로컬, 실제 API)

원자료: E2E `app/.verify/g2/e2e/round1..3/`, API 응답 `app/.verify/g2/api/`, 코드 리뷰 `app/.verify/g2/code/round{1,2,3}-codex.md`. 같은 흐름은 `app/tests/e2e/flow.mjs`(`pnpm test:e2e`)로 G3와 배포 검증에서 다시 실행했습니다.

### 4-1. E2E 범위 (round3 기준)
| 단계 | 확인한 내용 | 근거 |
|---|---|---|
| 설정 | 잘못된 업로드 3종 거절(.pdf로 이름만 바꾼 이미지, 손상 PDF, 31MB), PDF 2개(12쪽·58쪽) 첨부, 심사위원 3명 얼굴 생성, 발표·질의응답 각 1분 | `round3/s1-result.json` |
| 위키 | 두 자료 모두 빌드 완료 | `round3/s1-result.json` `wikiText` |
| 발표 | 카메라 미리보기, 슬라이드 버튼·방향키 이동, 실제 시각 기준 타이머, 60초 시간 종료, STT 전사 저장 | `round3/s1-result.json` |
| 질의응답 | 질문 6개(본 질문 1·예비 5) 생성, TTS 2회 재생, 음성 답변 저장, 상태 `report` 전환 | `round3/s2-result.json` |
| 결과 | 리포트 생성(`openai:gpt-6-astra`), 쪽 인용·발화 인용 시트 열림 | `round3/s2-result.json`, `round3/cite-result.json` |
| 기록 | 새로고침 뒤 목록 표시, 다시 열 때 `/api/report` 재호출 없음, "다시 시작하기"가 같은 설정으로 새 세션 생성 | `round3/hist-result.json`, `round3/restart.log` |
| API 오류 | 6개 라우트에서 빈 본문·JSON 아님·스키마 오류 → 400, 4.1MB 본문 → 413, 음수·21600초 초과 타임스탬프 → 400 | `round1/api-errors.txt`, `round3/tneg.json` |
| 키 노출 | 내려받은 39개 파일(8.4MB)에서 키 값 0건 | `round1/keyscan.json` |

### 4-2. 로컬 소요 시간 (초, 드라이버가 폴링 간격 단위로 잰 값)
| 단계 | round2 | round3 | maxDuration |
|---|---|---|---|
| 심사위원 3명 얼굴 (`gpt-image-2`) | 11.0 | 11.0 | 120 |
| 위키 (12쪽 + 58쪽 동시 빌드) | – | 194 | 300 |
| 질문 6개 | 30.0 | 27.0 | 120 |
| 리포트 (`gpt-6-astra` 다단계) | 116 | 120 | 300 |

리포트는 G0 단일 평가 호출(28초, D3)과 달리 지표 계산·자료 평가·문항별 평가·종합을 여러 번 호출하기 때문에 120초 안팎이 걸렸습니다. 그래도 maxDuration 300초의 40% 수준이어서 여유가 있습니다.

### 4-3. 코드 리뷰 (Codex `gpt-6-astra`)
| 회차 | P0 | P1 | P2 | 처리 |
|---|---|---|---|---|
| round1 | 0 | 5 | 6 | 출처 검사·STT 늦은 소켓·Q&A 이탈 뒤 녹음 재시작 수정 |
| round2 | 0 | 2 | 8 | 리포트 타임스탬프 상한(21600초) 추가 |
| round3 | 0 | 4 | 4 | 클라이언트 번들에서 키 접근 경로 없음 확인. 남은 4건(Q&A 재개, 저장 실패 시 진행, 시간 종료 직후 전사 경합, chunked 본문 상한)은 G2 P2로 넘겨 G3에서 수정 |

## 5. G3 완성·배포 검증

원자료: `app/.verify/g3/` (P2 수정별 폴더, `cleanup-tests/`, `visual/`, `recheck1/`, `deploy/`, `deployed/round1/`).

### 5-1. G2 P2 처리 결과 (로컬)
| P2 | 결과 | 근거 |
|---|---|---|
| Q&A 답변 문장 `t` 역순, 발표 종료 직후 마지막 문장 경합 | 수정. 이어 붙인 문장의 `t`를 말하기 시작한 시각으로 두고, `stop()`이 이번 실행의 문장을 돌려줌 | `core-p2/results-fake.json`, `core-p2/results-live.json`, `core-sentence-t/fallback-sim.out.txt` |
| Q&A 재개 시 꼬리질문·답변 유실 | 수정. 대기 중이던 꼬리질문을 먼저 묻고, 쓰던 답변을 복원함 | `SCREENS-B/qa-results.json` |
| 저장 실패 시에도 진행 | 수정. 다시 시도 안내를 띄우고, 저장에 성공할 때까지 다음 단계로 넘어가지 않음 | `SCREENS-B/present-results.json`, `SCREENS-B/qa-results.json` |
| 확인 대화상자 중 STT 계속 녹음 | 수정. 대화상자가 열리면 전사와 시계를 멈춤 | 같은 파일 |
| IndexedDB 오류를 '기록 없음'으로 표시, `/result`가 진행 중 세션의 리포트 생성 | 수정. 오류 화면과 "다시 시도"를 따로 두고, 진행 중 세션은 원래 단계로 보냄 | `result-unfinished/run.log`, `screens-b-fix/copy-check.json` |
| chunked 요청 본문 상한 | 수정. `content-length` 없이 6MB를 보내도 413 | `api-p2/body-cap.out.json` |
| LintIssue 스키마 중복 | 수정. 질문·리포트가 공용 스키마를 씀 | `api-p2/lint-schema.out.json` |
| 꼬리질문 답변 4000자 상한 | 수정. 9000자 답변을 4022자로 잘라 판정(200, 5.2초) | `api-p2/followup-long.out.json` |
| 교체된 PDF·얼굴 blob 누수 | 수정. 다른 세션이 쓰는 PDF는 남기고, 고아 blob 0개 | `setup-blob-leak/results.json` |
| 위키 없는 장문 자료가 리포트에서 0점 | 수정. 위키 없이도 자료 점수 51점·근거 인용 19건, 결과 화면이 빠진 위키를 먼저 빌드함 | `api-p2/report-nowiki.summary.json`, `result-unfinished/run.log` |
| 네이티브용 CORS·origin 허용 목록 | 수정. `ALLOWED_ORIGINS`(D17) | `api-p2/origin-allowlist.out.json` |
| 미사용 export | 일부 남음. knip 기준 `src`에 `PdfError` 1건 | `cleanup-tests/knip.txt` |

### 5-2. 정리·테스트 (배포 직전)
| 항목 | 결과 | 근거 |
|---|---|---|
| 단위 테스트 `pnpm test` | 25/25 | `recheck1/tests/unit.log` |
| API 스모크 `pnpm test:api` | 14/14 | `recheck1/tests/api.log` |
| `next build`, `tsc`, ESLint | 통과, 오류 0 | `recheck1/tests/build.log`, `cleanup-tests/{tsc,eslint}.log` |
| 키 검사 (정적 파일·서버 HTML·RSC) | 6개 키 모두 0건 | `cleanup-tests/keyscan.json` |
| 전체 흐름 E2E `pnpm test:e2e` | 10/12. 실패 2건은 얼굴·위키 생성이며 원인은 제공자 불가(U9·U10) | `recheck1/e2e/`, `cleanup-tests/e2e.out` |
| 저하 경로 | 질문 200(폴백 체인), 꼬리질문 200×2, TTS 503 → 화면 글자 안내, 리포트 200(Gemini lite, 안내 문구 표시), 기록 표시 | `recheck1/verdict.json`, `recheck1/degraded/` |
| 레이아웃 | 모바일 가로 넘침 0, 데스크톱 목업 화면 361×823·모서리 59px 안에 하단 바 포함(7개 화면), 이미지 필터 없음, Q&A 사진 채도 102.8(원본 108.1) | `recheck1/verdict.json` |
| 시안 비교 (Claude CLI) | 화면마다 P1 0–2건, P2 4–21건 보고. 실측 확인 결과 P1 0건으로 판정했고, 크기·굵기·여백 차이는 P2로 남김(U13) | `recheck1/visual/claude-*.md`, `recheck1/verdict.json` |
| 문구 검토 (Codex) | 수정 제안 16건 중 일부 반영(예: "페이지를 표시하지 못했어요"). 랜딩·기록 화면의 머리 문구는 그대로 둠 | `copy/codex.md`, `core-sentence-t/served-copy.txt` |

### 5-3. 배포
| 항목 | 값 | 근거 |
|---|---|---|
| URL | https://pr-sim-lake.vercel.app (배포 `dpl_EbiiHdQSNR3f34W4Bq8PtBG7KEky`, READY) | `deploy/summary.json` |
| 방식 | Vercel CLI 65.14.0, `app/`에서 배포(`--cwd app`). 프로젝트 Root Directory는 비워 둠. Git 자동 연결은 바로 해제 | `deploy/01-link.log`, `deploy/02-git-disconnect.log` |
| 리전·런타임 | `icn1`, fluid compute, Node 26.x (`app/vercel.json`) | `deploy/05-region.log` |
| 빌드 | pnpm 11.6.0 설치 16초, `next build` 16.4.6 45초. 화면 6개 모두 정적(○), API 7개 동적(ƒ) | `deploy/10-build.log` |
| 환경변수 | `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_API_KEY` 3개만 production·preview에 sensitive로 등록 | `deploy/summary.json` |
| 업로드 제외 | `app/.vercelignore`: `.env*`, `.verify/`, `tests/`, `.next/` | `deploy/08-upload-check.log` |
| 사고 | `vercel link`가 `app/.env.local`(루트 `.env` 심볼릭 링크)에 `VERCEL_OIDC_TOKEN`을 덧붙임 → 추가된 3줄 제거, 원래 키 6개로 복구 | `deploy/summary.json` `incidents` |

### 5-4. 배포 URL 실측 (2026-11-13 05:00–05:15 KST)
| 제약 | 측정 | 판정 | 근거 |
|---|---|---|---|
| 파일시스템 | `src`에 런타임 파일 쓰기 없음(빌드 스크립트 `sync-pdfjs.mjs`만). 기록은 IndexedDB에 저장되고, 새로고침·브라우저 재시작 뒤에도 남으며, 다른 프로필에서는 보이지 않음 | 통과 | `deployed/round1/fs-grep.txt`, `deployed/round1/qa-stdout.log` |
| 리전 | 모든 API 응답의 `x-vercel-id`가 `icn1` | 통과 | `deployed/round1/api-probes.json` |
| 질문 | 9.0초 / 120초 | 여유 | `deployed/round1/timings.json` |
| 꼬리질문 | 7.1·4.8초 / 60초 | 여유 | 같은 파일 |
| 리포트 | 55초 / 300초 (Gemini `3.5-flash-lite`×5·`3.1-flash-lite`×2 폴백) | 여유 | 같은 파일 |
| STT 토큰 | 0.48·0.40초 / 10초 | 여유 | 같은 파일 |
| 위키 58쪽 | 측정 못 함. 214ms 만에 `providers_unavailable`(U9·U10). 로컬 참고값 194초(4-2), 라우트는 280초에 504로 끊음 | 미확인 | `deployed/round1/wiki-timing.json` |
| 시간 초과 | 504·`FUNCTION_INVOCATION_TIMEOUT` 0건 | 통과 | `deployed/round1/timings.json` |
| 본문 상한 | 4.2MB → 앱 413 `too_large`(JSON) / 4.7·5.1MB → 플랫폼 413 `FUNCTION_PAYLOAD_TOO_LARGE`(text/plain) / 121쪽 → 앱 413. 클라이언트는 전송 전에 크기를 검사하고 맨 413도 `too_large`로 바꿔 보여 줌 | 통과 | 같은 파일 `bodyLimit` |
| HTTPS·권한 | 보안 컨텍스트에서 `mediaDevices` 사용 가능. 카메라·마이크 권한을 거부하면 "권한이 필요해요"와 다시 시도 버튼 표시 | 통과 | `deployed/round1/extras/results-denied.json` |
| 자동 재생 | 사용자 제스처 없는 `play()`는 `NotAllowedError`(대조군). 시작 버튼을 누른 뒤에는 2.5초 늦게 온 TTS도 재생됨 | 통과 | `deployed/round1/extras/results-autoplay.json` |
| 데스크톱 1440×900 | 6개 화면 목업 392×852 중앙 배치, 가로 넘침 없음, 필터 없음 | 통과 | `deployed/round1/extras/results-desktop.json` |
| API 오류 | 6개 라우트 빈 본문 400, 토큰은 Origin 없으면 403·있으면 200, 모두 `cache-control: no-store` | 통과 | `deployed/round1/api-probes.json` |
| 키 노출 | 제공 파일 28개(JS 19개, 2.2MB)에서 키 값 0건, `sk-`·`AIza`·`sk-ant-` 패턴 0건 | 통과 | `deployed/round1/keyscan.json` |
| 전체 흐름 | `flow.mjs` 10/12(얼굴·위키 실패, 화면은 오류를 안내함). 시드 세션 Q&A→결과→기록 13/13 | BLOCKED | `deployed/round1/verdict.json` |

판정: P0 0건, P1 0건, P2 3건(verdict.json에 세부 항목은 적혀 있지 않음). 외부 제공자의 한도 초과와 크레딧 소진 때문에 "얼굴 생성"과 "위키 빌드"를 배포 URL에서 확인하지 못했으므로 상태는 BLOCKED입니다.

### 5-5. 남은 P2 정리 (2026-11-13, 로컬)

원자료: `app/.verify/g3/p2/` (작업자별 폴더, `verify-1`–`verify-4`, `tail/`).

| P2 | 결과 | 근거 |
|---|---|---|
| U13 시안 시각 차이 | 수정. 설정(밀도·슬라이더·업로드·CTA·제목), 발표(타이머 60px/900, 종료 알약, 진행 막대, 슬라이드 카드, 카메라, 조작 버튼, 하단 바), 심사(얼굴 카드 맞춤, 답변 칸 3줄, 마이크 바), 결과·피드백·기록 항목 처리. 시안에 없는 기능 요소(교체, 샘플 자료, 장애 안내, 다시 듣기)는 남기되 눈에 덜 띄게 함 | `verify-1`–`verify-4/visual-*`, `tail/verify/visual/` (320·390 폭) |
| U14 hallmark sloplint | 수정. 색 리터럴을 토큰으로, `transition-[width]` 제거(transform), `overflow-x: clip`, 가운뎃점 메타 줄 정리. Hallmark 도장 주석 규칙은 해당 없음 | `shell/`, `verify-*/review` |
| U15 `PdfError` | 이미 제거돼 있었음. 이번 변경으로 안 쓰게 된 아이콘·prop도 제거 | `tail/fix/` |
| U17 zod 영어 문구 | 수정. 요청 검증 400의 `issues[].message`를 한국어로 바꾸는 매퍼(LLM 출력 스키마에는 적용 안 함) | `server/tts-400-ko.txt` |
| U18 macOS 남성 기기 음성 | 개선. 남성 심사위원은 기본 한국어 음성을 낮춰(pitch ×0.75) 쓰고, Premium/Enhanced 음성을 우선함 | 단위 테스트(가짜 음성 목록) |
| 얼굴 통합 안내 | 수정. 원인이 섞여도 안내 1개, 새로고침 뒤에도 저장된 심사위원 상태로 다시 만듦 | `setup/`, `faceNotice.test.mts` |
| 위키 인용 쪽 경계 5/173 | 수정. 날짜·일수 수치도 재근거화 대상에 넣음. 실제 오인용 3건 해결, 나머지 2건은 계산값·검사식 오탐. 저장된 위키 5개에서 날짜 오인용 12→0 | `server/cite-audit-{old,new}.json` |
| STT 도메인 어휘 | 수정. 위키 용어를 Live STT 토큰의 `customVocabulary`로 전달. 같은 음성에서 '완충제'→'완충재' | `server/live-vocab-run.txt` |
| 질문 생성 전체 실패 분류 | 수정. 모든 심사위원이 제공자 장애로 실패하면 `providers_unavailable`(503)로 응답 | `tail/verify/checks/` |
| 인메모리 레이트리밋 | 보류. 공유 저장소(KV)와 인증이 있어야 의미 있음 | — |

검증: tsc·lint 0 오류, 단위 50/50, API 14/14, 빌드 통과, 번들 키 0건. 독립 검증 4라운드에서 P1 5건(STT 토큰 빈 본문, 슬라이드 높이 하한, 심사 화면 얼굴 가림 2건, E2E 대기 경합)을 고친 뒤 P0/P1 0건. 로컬 E2E 실패 4건은 모두 제공자 장애(U1·U9·U10)입니다.

## 6. 결정 (G2·G3)

고정 결정의 정의는 run.md에 있고, 여기에는 근거와 실측만 적습니다.

| # | 결정 | 근거 |
|---|---|---|
| D11 | 서버 무상태, 세션·PDF·위키·얼굴·리포트는 IndexedDB `pr-sim`(`sessions`·`blobs`)에 저장 | 배포 환경에서 재시작 뒤 유지, 다른 프로필에서는 안 보임, 런타임 파일 쓰기 0건(5-4) |
| D12 | 화면 라우트는 경로 대신 쿼리 파라미터(`?s=`)로 세션을 받음 | 빌드 결과 화면 6개가 모두 정적(○) → Capacitor 정적 내보내기 후보(`deploy/10-build.log`) |
| D13 | TTS 체인은 요청마다 한 번만 순회함. 모두 실패하면 503 `providers_unavailable`을 돌려주고, 화면은 질문을 글자로 보여 주며 Q&A를 이어 감 | Gemini 일일 한도·OpenAI 크레딧 소진 상태에서 Q&A가 끝까지 진행됨(`deployed/round1/qa-stdout.log`) |
| D14 | 질문·리포트 체인 끝에 Gemini flash 계열을 추가: 리포트 `gpt-6-astra` → `gpt-6.1-sol` → `gpt-5.5` → Gemini(`REPORT_GEMINI_MODELS`) → Claude. 실제로 쓴 제공자와 폴백 사유를 결과 화면에 표시 | OpenAI 크레딧 소진 상태에서 리포트 55초 생성(5-4). D3·D6의 순서를 바꾸지 않고 확장 |
| D15 | ~~위키는 OpenAI → Claude만 사용~~ → D20으로 대체 | U9·U10이 겹쳐 위키 경로가 끊겼기 때문 |
| D16 | 앱 본문 상한 4MB(`content-length`와 chunked 모두), 플랫폼 상한 4.5MB 아래에서 JSON 413을 돌려줌 | 5-4 본문 상한 |
| D17 | `ALLOWED_ORIGINS`(쉼표 목록, `scheme://host[:port]` 정확 일치): 비우면 같은 출처만 허용. 목록에 있는 출처는 CORS 헤더를 받고, STT 토큰도 fetch-metadata 없이 발급 | 네이티브 앱(`capacitor://localhost`) 대비. 설정 시 preflight 204·POST 200, 다른 출처 403(`api-p2/origin-allowlist.out.json`). 현재 Vercel에는 설정 안 함 |
| D18 | 각 라우트는 `maxDuration`보다 먼저 스스로 끊음(위키·리포트 20초, 질문 10초, 꼬리질문 5초 전) | 플랫폼 강제 종료 대신 한국어 504를 보냄(`deployed/round1/fs-grep.txt`) |
| D19 | Vercel 배포는 CLI로 `app/`에서 하고, Git 자동 배포는 끔 | 커밋·푸시는 오케스트레이터만 함. run.md의 "Root Directory = `app`"과 달리 프로젝트 설정은 비어 있고 `--cwd app`으로 같은 효과를 냄(충돌 기록) |

| D20 | 위키·질문·꼬리질문·리포트 체인 끝에 Gemini lite(`gemini-3.5-flash-lite` → `gemini-3.1-flash-lite`)를 둠. 이 모델로 만든 위키는 `degraded`로 표시하고, 상황 설정 화면의 자료 행에 '경량 대체 모델로 분석했어요' 안내를 띄움 | 장애 중 12쪽 위키: 수치 인용 80/80이 해당 쪽에서 확인됨(`.verify/g3/resilience/critic2/`). 기본 순서는 그대로 OpenAI가 먼저 |
| D21 | 얼굴은 `gpt-image-2` → Gemini 이미지(`gemini-3.1-flash-image` → `gemini-3-pro-image`) 순서로 시도하고, 모두 실패하면 이름 첫 글자로 표시. 같은 원인으로 여러 명이 실패하면 안내를 한 번만 띄움 | 쿼터 오류에서는 재시도를 반복하지 않음(`.verify/g3/final/`) |
| D22 | TTS가 모두 실패하면 503 응답에 `fallback:"browser"`를 담음. 클라이언트는 기기 음성(`speechSynthesis`, 성향별 속도·높낮이)으로 읽고 '기기 음성으로 읽어 드려요'라고 알림. `platform.audio.speak` 뒤에 두어 Capacitor 네이티브 TTS로 바꿀 수 있음 | 배포 URL에서 질문 음성 재생 확인(`.verify/g3/resilience/deployed/`) |
| D23 | 발표 진행 막대는 지난 시간을 왼쪽부터 채움(시안 03·04 기준, 스크린리더 값과 일치). Live STT 토큰에 세션 위키 용어를 `customVocabulary`로 넣음 | 5-5 |

## 7. 미해결 문제 (G3 배포 기준)

| # | 문제 | 영향 | 대응 |
|---|---|---|---|
| U1 | Gemini 무료 등급 일일 한도(갱신) | 오늘 TTS 전부 503, 질문·리포트 폴백 후보도 줄어듦 | D13 글자 안내로 진행. 유료 등급 필요 |
| U2 | Live STT 한도 수치(갱신) | 배포 E2E에서는 정상 전사(11문장) | 수치는 여전히 미확인 |
| U4 | 58쪽 위키 시간(갱신) | 로컬 194초(12쪽 동시), 배포 미측정 | U9 해소 뒤 배포 URL에서 재측정 |
| U9 | OpenAI `credit_balance_exhausted`(2026-11-13 04시 무렵부터, 로컬과 배포 모두) | 얼굴·위키 생성 불가, OpenAI TTS 폴백 불가, 질문·리포트는 Gemini로 내려감 | 크레딧 충전 후 `pnpm test:e2e`를 `BASE_URL=https://pr-sim-lake.vercel.app`으로 다시 실행 |
| U10 | Claude API 2026-12-01까지 사용 불가 | U9와 겹치면 위키(D15)는 대체 경로가 없음 | 12-01 이후 재확인. 필요하면 위키에 Gemini 폴백 검토 |
| U11 | ~~배포 URL 전체 흐름 BLOCKED~~ → 해소: D20–D22 적용 후 배포 URL 전체 흐름 23/24 통과(장애 상황의 대체 경로) | 실제 얼굴 생성과 서버 음성은 아직 배포 URL에서 다시 확인하지 못함 | U9 해소 후 `BASE_URL=https://pr-sim-lake.vercel.app pnpm test:e2e` |
| U12 | `ALLOWED_ORIGINS` 미설정 | 지금은 웹만 쓰므로 영향 없음 | 네이티브 빌드 때 Vercel 환경변수 등록 |
| U13 | ~~시안과의 시각 차이 P2~~ → 해소(5-5) | — | 남은 미세 차이는 run.md P2 목록 |
| U14 | ~~hallmark sloplint~~ → 해소(5-5) | — | — |
| U15 | ~~미사용 export `PdfError`~~ → 해소 | — | — |
| U17 | ~~400 `issues[].message` 영어~~ → 해소(5-5) | — | — |
| U18 | macOS 남성 기기 음성(5-5에서 개선) | 장애 시에만 해당, 여전히 합성음 한계 | Capacitor 네이티브 TTS 또는 서버 TTS 복구 |
| U16 | 배포 판정의 P2 3건이 항목별로 기록되지 않음 | 추적 불가 | 다음 배포 재검증에서 항목을 적음 |

위키 인용 쪽 경계와 STT 도메인 어휘는 5-5에서 해소했고, 인메모리 레이트리밋은 run.md의 P2 목록에서 관리합니다.
