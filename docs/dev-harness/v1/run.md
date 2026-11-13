# PR-SIM v1 — Run (하네스)

이 파일 하나가 개발 통제 기록입니다. 세션이 다시 시작되면 여기서 이어 갑니다.
요구사항 원문: [docs/prompts/PROMPT_V1.md](../../prompts/PROMPT_V1.md) · 기술 결정·검증: [docs/dev-v1/report.md](../../dev-v1/report.md) · 위키: [docs/wiki/index.md](../../wiki/index.md)

## 현재 단계

| Gate | 상태 | 근거 |
|---|---|---|
| G0 준비 | PASS | CLI·제공자 실측, `docs/wiki/{tools,api-contract}.md`, `docs/dev-v1/report.md`, 원자료 `pocs/.verify/g0/bench/` |
| G1 PoC | PASS | 7개 PoC 독립 검증 1회차 전부 PASS(P0/P1 0건), 증거 `pocs/.verify/g1/<poc>/round1/` |
| G2 통합 | PASS | 독립 E2E 14항목 실제 API로 통과(`app/.verify/g2/e2e/round1..3/`), Codex gpt-6-astra 코드 리뷰 P1 3건 수정 후 round3 PASS |
| G3 완성·배포 | PASS (외부 제한 있음) | 시안 비교(Claude CLI, `app/.verify/g3/visual/`)·문구 검토·테스트(`pnpm test` 29/29, `test:api` 14/14)·빌드·키 노출 0건 → https://pr-sim-lake.vercel.app 배포 → 배포 URL 전체 흐름 23/24, 남은 P1 수정·재검증 후 재배포(`app/.verify/g3/final/`). 실제 얼굴·서버 음성은 OpenAI 크레딧 충전 뒤 재확인 필요(report.md U9·U11) |

## 고정 결정 (변경 시 report.md에 근거 기록)

- **레포 구조**: git 루트 = 프로젝트 루트 (`docs/`, `assets/`, `pocs/`, `app/`). origin = github.com/mojomoth/pr-sim, 브랜치 `main`.
- **PoC 호스트**: `pocs/` (Next 16.4, 포트 3100). `/pocs/<name>` rewrite로 7개 PoC 접근.
- **v1 앱**: `app/` (Next.js 16.x App Router, React 19, TypeScript, Tailwind v4, pnpm, 포트 3000). Vercel 프로젝트 `pr-sim`, CLI `--cwd app`으로 배포(Git 자동 배포 끔, report.md D19). 운영 URL https://pr-sim-lake.vercel.app (icn1).
- **디자인 기준**: `docs/screens/draft/*.png` 7종 + `docs/screens/draft/DESIGN.md`. 손그림 원본은 `docs/screens/design/`. **심사위원 얼굴·카메라·슬라이드는 컬러**(DESIGN.md 흑백 얼굴 지침보다 우선). 브랜드: `assets/bi/`, 랜딩 배경: `assets/landing/hero-stage-*-v2.png`.
- **반응형**: 데스크톱(≥ 768px 폭이고 세로 여유가 있을 때) `assets/mockup-iphone.png`(851×1848) 중앙 배치, 실제 화면 영역에 앱 렌더. 모바일은 목업 없이 전체 화면 + `env(safe-area-inset-*)`.
- **저장소(배포 제약 대응)**: Vercel 서버리스 파일시스템은 휘발성 → 서버는 무상태. 세션·PDF·위키 페이지·심사위원 이미지·전사·Q&A·리포트는 **브라우저 IndexedDB**에 저장. Capacitor WebView에서도 동작.
- **PDF**: 브라우저에서 pdf.js로 렌더·페이지별 텍스트 추출. 용량 제한·형식 검사는 클라이언트+서버 모두. 서버엔 PDF 원본 대신 페이지 텍스트만 전송(Vercel 요청 본문 4.5MB 제한 회피).
- **네이티브 분리**: 카메라·마이크·저장소·오디오 재생은 `app/src/platform/` 인터페이스 뒤에 둔다(지금은 web 구현만, 네이티브 프로젝트 생성 안 함).
- **AI 모델**: STT = Gemini Live(`gemini-3.5-transcribe-live`, 에페메랄 토큰) / TTS = Gemini TTS(쿼터 소진 시 폴백은 report.md 결정) / 얼굴 = OpenAI `gpt-image-2` / 질문 = `gpt-6.1-terra`(low) / 꼬리질문 = `gpt-5.5`(low) / 리포트 = `gpt-6-astra`(medium) / 위키 = `gpt-6.1-terra`(low)+개요 `gpt-6.1-sol` / TTS 폴백 = Gemini 3.8 flash-tts → flash-lite-tts → OpenAI `gpt-4o-mini-tts` (근거 report.md). Claude API는 2026-12-01까지 한도 초과 → 폴백 전용.
- **라우트**: `/`, `/setup`, `/present?s=`, `/qa?s=`, `/result?s=[&tab=feedback]`, `/history` — 쿼리 파라미터 id로 Capacitor 정적 내보내기 대비. 서버 코드는 `app/src/server/**`, 클라이언트 코어는 `app/src/features/**`·`app/src/platform/**`.
- **키**: `.env`(루트) → `app/.env.local`, `pocs/.env.local`. 서버 Route Handler에서만 사용. 클라이언트 번들·로그·git 금지. Vercel에는 환경변수로 등록.

## 에이전트 역할과 파일 소유권

| 역할 | 실행 주체 | 소유 |
|---|---|---|
| Orchestrator | Claude Code 메인 세션 (Opus 5.5) | `docs/dev-harness/v1/run.md`, 커밋·푸시 |
| UI Builder | Claude 워크플로 에이전트 (Opus 5.5) | `app/src/app/**`, `app/src/components/**` |
| Feature Builder | Claude 에이전트 + Codex CLI `gpt-6.1-sol` | `app/src/features/**`, `app/src/app/api/**`, `app/src/platform/**` |
| Image Maker | Codex CLI (`gpt-6-astra`, 이미지 생성·수정) | `app/public/**` 생성 이미지 |
| Code Critic | Codex CLI `gpt-6-astra` (독립 리뷰) | 쓰기 없음, 결과는 `.verify/` |
| Visual Critic | Claude CLI (`claude -p`, 스크린샷 대 시안 비교) | 쓰기 없음, 결과는 `.verify/` |
| Docs | Claude 에이전트 + fluent-korean | `docs/dev-v1/report.md`, `docs/wiki/**` |

구현자와 검증자는 항상 다른 에이전트. 검증자는 실제 실행 화면·API 응답을 보고 판정한다.

## 게이트 통과 조건

- **G0**: 기존 파일 확인 · Codex/Claude CLI 실행 · 모델·API 접근 확인 · 개발 서버 · 최소 API 계약(`docs/wiki/api-contract.md`) · 하네스 · 도구 적용법(`docs/wiki/tools.md`)
- **G1**: 7개 PoC(`ui, stt-tts, wiki, judge, slide, question, report`) 핵심 기능 실제 실행 · `/pocs/...` 접근 · 실제 API 호출 · 입출력 검증 · 실패·제한 기록
- **G2**: 랜딩→목록 전체 이동 · PDF 업로드·발표 · 타이머 · STT/TTS · 페르소나 질문 · 답변 수집 · 근거 기반 리포트 · 기록 저장·재조회
- **G3**: 시안 비교 · 모바일/데스크톱 검증 · 핵심 인터랙션 · 불필요 UI·코드 제거 · 빌드·테스트 · 키 노출 검사 · 배포 · 배포 URL 재검증

P0/P1은 반드시 수정. P2는 아래 목록에 기록 후 진행 가능.

## TODO / 완료

- [x] G0 기존 프로젝트·제공 파일 확인 (PoC 7종 + fixtures + hil 존재, 시안 7종, BI, 랜딩 이미지)
- [x] G0 git 루트 이전·푸시 (`5f9c820`), 과거 세션 로그의 키 문자열 마스킹
- [x] G0 Codex CLI(`gpt-6-astra`, `gpt-6.1-sol`)·Claude CLI 실행 확인
- [x] G0 제공자 1차 확인 (2026-11-13): OpenAI OK(gpt-5.5, gpt-6-astra, gpt-6.1-sol, gpt-image-2) · Claude 한도 초과(12-01 복구) · Gemini 무료 등급 일일 한도 · Vercel/Render 토큰 OK · `JEV_KEY` 용도 미상
- [x] G0 PoC 개발 서버(3100) + `/pocs/*` rewrite, 7개 경로 200
- [x] G0 도구 적용법(`.claude/skills/` 9종 설치), API 계약, 모델 측정, report/wiki 초기화
- [x] G1 PoC 독립 검증 (수정 루프 불필요)
- [x] G2 v1 앱 (셸·코어·API 7종·화면 6종, P1 3건 수정: STT 늦은 소켓 정리, Q&A 언마운트 정리, 리포트 타임스탬프 상한)
- [x] G3 P2 정리, 시안 비교·시각/문구 수정, ponytail 정리, 테스트·빌드·키 검사, Vercel 배포
- [x] G3 제공자 장애 대응(위키 Gemini lite, 얼굴 이니셜, 기기 음성 TTS), 배포 URL 재검증 23/24 → P1 수정 후 재배포
- [x] 남은 P2 정리(report.md 5-5), 독립 검증 P0/P1 0, 재배포
- [ ] OpenAI 크레딧 충전 뒤 배포 URL에서 얼굴 생성·서버 음성 포함 `pnpm test:e2e` 재실행 (외부 차단)

## P2 보류 목록 (★ = G2에서 반영 완료)

G2 신규 P2(G3에서 모두 처리함): Q&A 답변 문장 t 역순 · Q&A 재개 시 꼬리질문 유실 · 저장 실패 시에도 진행 · 발표 종료 직후 STT 마지막 문장 경합 · 확인 대화상자 중 STT 계속 녹음 · IndexedDB 오류를 '기록 없음'으로 표시 · /result가 진행 중 세션도 리포트 생성 · chunked 요청 본문 상한 · LintIssue 스키마 중복 · 꼬리질문 답변 4000자 상한 · 교체된 PDF/얼굴 blob 누수 · 미사용 export(아이콘 3, readRawPage, validatePdf) · 네이티브용 CORS/origin 허용 목록 · 리포트에 위키 없는 장문 자료 0점

- ★ 업로드 전 클라이언트 용량·형식 검사 + 서버 측 검사(wiki/slide PoC는 클라이언트 또는 서버 한쪽만)
- ★ 쿼터 오류 재시도 시간을 사람이 읽는 형태로(초 단위 X)
- ★ 리포트 발화 인용을 0-based 인덱스가 아니라 시각·발화 원문 링크로
- ★ 존재하지 않는 세션 딥링크 → '기록을 찾을 수 없어요' 안내
- ★ API 오류 응답 형태 통일 `{error:{kind,message}}`, 빈 본문은 400
- ★ TTS 한 요청이 Gemini를 여러 번 호출하지 않도록 폴백 체인 1회 순회
- ★ 질문·리포트에 실제 사용한 제공자 표기(Claude 실패 후 OpenAI면 OpenAI)
- ★ 발표·심사 화면 390×844에서 심사위원 행/마이크 행이 고정 하단 바에 가려지지 않게
- Gemini 무료 등급 일일 한도(TTS·배치 전사) — 유료 등급 필요, 폴백으로 운영
- 서버리스 인메모리 레이트리밋 한계 (인증·공유 저장소 도입 전까지 유지)

2026-11-13 P2 정리(report.md 5-5)에서 처리함: 시안 시각 차이 · hallmark sloplint · 위키 인용 쪽 경계 · STT 도메인 어휘 · 얼굴 통합 안내(원인 혼합·새로고침) · zod 한국어 문구 · macOS 남성 기기 음성 · 질문 전체 실패 분류 · lint 범위 · E2E 2회차 진행 조건

남은 미세 P2(기록만): 320px에서 슬라이드 조작 버튼과 카메라 사이 여유 1px · 320px 심사 화면에서 답변 중 작은 얼굴이 상단 바 뒤로 감 · 320px 설정 화면 얼굴 안내가 좁은 칸에서 6줄 · '기기 음성' 표시가 줄 끝 가운뎃점 뒤에서 줄바꿈 · Badge `tone="surface"` 미사용 · 설정 화면 높이 시안 대비 약 2.8배(시안 2.46배) · '빡셈' 칩 터치 폭 42–43px · 새로고침 뒤 얼굴 안내가 원인 없는 문구로 바뀜

## 마지막 검증 결과 / 다음 작업

- 마지막: G3 최종 재검증 PASS·재배포 READY (2026-11-13, `dpl_Hf85d6yTHqhSmeuKbLLaYBwk86z2`)
- 다음: (외부) OpenAI 크레딧 충전 또는 Gemini 유료 등급 → `cd app && BASE_URL=https://pr-sim-lake.vercel.app pnpm test:e2e`로 얼굴·서버 음성 포함 재검증. 이후 P2 시각 차이 정리, Capacitor 포팅(`ALLOWED_ORIGINS` 등록)
