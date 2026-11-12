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
