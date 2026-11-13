# 위키 변경 기록

append-only입니다. 새 항목은 맨 아래에 추가합니다. 최근 항목 확인: `grep "^## \[" docs/wiki/log.md | tail -5`

## [2026-11-12] ingest | 브랜드 아이덴티티
- 바뀐 파일: `brand-identity.md`, `README.md`(목록)
- 근거: 사용자가 고른 Monochrome 보드(`docs/bi/monochrome/identity-board.png`), `assets/bi/`
- 비고: 이 항목은 LLM Wiki 체계를 도입하면서 2026-11-13에 파일 시각을 근거로 소급 기록했습니다.

## [2026-11-13] ingest | v1 최소 API 계약
- 바뀐 파일: `api-contract.md`
- 근거: run.md 고정 결정, `pocs/` API 경로
- 비고: 다른 G0 작업이 만든 페이지입니다. 이 항목은 목록에 반영하면서 기록했습니다.

## [2026-11-13] init | LLM Wiki 구조 도입
- 바뀐 파일: `index.md` 추가, `log.md` 추가, `README.md` 삭제
- 근거: Karpathy LLM Wiki gist (commit `ac46de1`)
- 내용: `README.md`의 페이지 목록(브랜드 아이덴티티 1건)을 `index.md`로 옮겼습니다. 원천 자료 목록과 운영 규칙(스키마)을 `index.md`에 두었습니다.

## [2026-11-13] ingest | 개발 도구 적용법
- 바뀐 파일: `tools.md` 추가, `index.md` 목록
- 근거: fluent-korean `ce8683f`, ponytail `96608e0`, no-ai-slop `000650b`, hallmark `04977e1`, gauntlet-loop `9b1975a`, LLM Wiki gist `ac46de1`
- 내용: 프로젝트 스킬 9개를 `.claude/skills/`에 설치했습니다(`fluent-korean`, `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `no-ai-slop`, `hallmark`, `gauntlet-loop`, `llm-wiki`). hallmark sloplint 정적 검사를 `pocs/ui`에 실행해 동작을 확인했습니다.

## [2026-11-13] ingest | G2 통합 검증 결과
- 바뀐 파일: 없음(위키 페이지 변경 없음). 결과는 `docs/dev-v1/report.md` 4절에 정리
- 근거: `app/.verify/g2/e2e/round1..3/`, `app/.verify/g2/api/`, `app/.verify/g2/code/round{1,2,3}-codex.md`
- 내용: 실제 API로 랜딩부터 기록까지 E2E를 round3에서 통과했습니다. Codex 리뷰 P1은 5건, 2건, 4건 순으로 줄었고, round3의 4건은 G3에서 고쳤습니다. 로컬 소요 시간은 얼굴 11초, 위키 194초(12쪽과 58쪽 동시), 질문 27–30초, 리포트 112–120초였습니다.

## [2026-11-13] ingest | G3 정리·시안 비교
- 바뀐 파일: 없음. 결과는 report.md 5-1·5-2절에 정리
- 근거: `app/.verify/g3/{core-p2,core-sentence-t,SCREENS-B,screens-b-fix,result-unfinished,api-p2,setup-blob-leak,cleanup-tests,copy,visual,recheck1}/`
- 내용: G2 P2 14건 가운데 13건을 고쳤고, 미사용 export는 `PdfError` 1건이 남았습니다. 단위 테스트 25/25, API 스모크 14/14, 빌드·tsc·ESLint 오류 0, 키 노출 0건입니다. Claude CLI 시안 비교가 보고한 P1은 실측으로 확인되지 않아 P2로 남겼습니다.

## [2026-11-13] ingest | Vercel 배포와 배포 URL 재검증
- 바뀐 파일: 없음. 결과는 report.md 5-3·5-4절과 결정 D11–D19, 미해결 U9–U16에 정리
- 근거: `app/.verify/g3/deploy/summary.json`, `app/.verify/g3/deployed/round1/{verdict,timings,wiki-timing,api-probes,keyscan}.json`, `deployed/round1/extras/`
- 내용: https://pr-sim-lake.vercel.app (`icn1`)에 배포했습니다. 파일시스템 쓰기 0건, 시간 초과 0건, 본문 상한은 앱 413과 플랫폼 413으로 나뉘고, HTTPS·권한 거부·자동 재생도 통과했습니다. OpenAI 크레딧 소진과 Claude 사용 불가 때문에 얼굴·위키 생성을 확인하지 못해 판정은 BLOCKED입니다.
- 충돌: run.md 고정 결정은 "Vercel Root Directory = `app`"이지만, 실제 프로젝트 설정은 비어 있고 CLI `--cwd app`으로 배포했습니다. report.md D19에 기록했고, run.md 수정은 오케스트레이터 몫입니다.

## [2026-11-13] ingest | v1 앱 구조
- 바뀐 파일: `architecture.md` 추가, `index.md` 목록과 원천 자료 표
- 근거: `app/src/app/**`, `app/src/features/session/api.ts`, `app/src/server/{ai,question,report,wiki}/`, `app/.verify/g3/deploy/10-build.log`
- 내용: 화면 7개(시안 01–07)를 파일, 부르는 API, 서버 모듈로 이어 정리했습니다. api-contract.md에는 화면 쪽 정보가 없어서 페이지를 따로 두었습니다.

## [2026-11-13] lint | G3 종료 점검
- 바뀐 파일: `index.md`(report.md 설명이 "파일 없음"으로 낡아 있던 것을 고침)
- 근거: `docs/wiki/*.md` 상대 링크 확인
- 내용: 깨진 상대 링크 0건, 목록에 빠진 페이지 0건입니다. api-contract.md의 오류 JSON(`{ error: { code, message } }`)은 배포 실측(`api-probes.json`)과 같습니다.

## [2026-11-13] decision | 제공자 장애 대응과 최종 재배포
- 바뀐 파일: `docs/dev-v1/report.md`(D15→D20, D21·D22, U11 해소, U17·U18)
- 근거: `app/.verify/g3/resilience/**`, `app/.verify/g3/final/**`
- 내용: OpenAI 크레딧 소진·Claude 한도·Gemini 한도가 겹친 상태에서도 연습이 끝까지 가도록 위키 Gemini lite 폴백, 얼굴 이니셜 대체, 기기 음성 TTS 폴백을 넣었습니다. 배포 URL 전체 흐름이 23/24로 통과했고, 남은 1건(위키 품질 저하 안내)은 고친 뒤 재배포했습니다.

## [2026-11-13] decision | 남은 P2 정리와 재배포
- 바뀐 파일: `api-contract.md`(STT 토큰 `vocabulary`), `docs/dev-v1/report.md`(5-5, D23, U13–U18), `docs/dev-harness/v1/run.md`(P2 목록)
- 근거: `app/.verify/g3/p2/**`
- 내용: 시안 시각 차이, sloplint, 위키 날짜 인용 쪽 경계, STT 도메인 어휘, 얼굴 통합 안내, 한국어 검증 문구, 기기 음성 선택을 고쳤습니다. 독립 검증 P0/P1 0건 뒤 재배포했습니다.
