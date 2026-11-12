# PR-SIM 위키

PR-SIM 개발에 필요한 지식을 모아 두는 곳입니다. [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 방식을 따릅니다. 원천 자료는 고치지 않고, 위키 페이지는 Docs 역할이 계속 고쳐 갑니다. 변경 기록은 [log.md](log.md)에 있습니다.

## 위키 페이지

| 페이지 | 내용 | 갱신 |
|---|---|---|
| [브랜드 아이덴티티](brand-identity.md) | 확정 로고와 사용 기준: 흑백 심볼·워드마크, 기준 색상, 컬러로 두는 미디어 | 2026-11-12 |
| [개발 도구 적용법](tools.md) | fluent-korean, ponytail, no-ai-slop, hallmark, gauntlet-loop, LLM Wiki를 어느 게이트·역할에서 어떻게 쓰는지 | 2026-11-13 |
| [v1 최소 API 계약](api-contract.md) | `app/src/app/api/**` 경로, 요청·응답 형식, 서버 무상태 원칙 | 2026-11-13 |
| [log.md](log.md) | 위키 변경 기록 (append-only) | 계속 |

## 원천 자료

위키 페이지의 근거가 되는 문서입니다. 위키 작업 중에는 읽기만 합니다.

| 문서 | 내용 |
|---|---|
| [docs/dev-harness/v1/run.md](../dev-harness/v1/run.md) | 개발 통제 기록: 현재 게이트, 고정 결정, 역할과 파일 소유권, 게이트 통과 조건 |
| [docs/dev-v1/report.md](../dev-v1/report.md) | 기술 결정과 검증 결과 (G0에서 작성 예정, 2026-11-13 기준 파일 없음) |
| [docs/screens/draft/DESIGN.md](../screens/draft/DESIGN.md) | 화면 디자인 기준: 토큰, 컴포넌트, 시안 7종 해석 |
| [docs/prompts/PROMPT_V1.md](../prompts/PROMPT_V1.md) | v1 요구사항 원문 |

## 운영 규칙

이 절이 위키의 스키마입니다. 절차는 `.claude/skills/llm-wiki/SKILL.md`를 따르고, 둘이 다르면 이 절을 따릅니다.

1. **소유**: `docs/wiki/**`는 Docs 역할이 씁니다(run.md 역할표). 다른 역할은 위키를 고치지 않고 Docs에 근거를 넘깁니다.
2. **페이지**: 주제 하나에 페이지 하나를 둡니다. 파일 이름은 영어 소문자와 하이픈(`api-contract.md`)을 쓰고, 본문은 한국어로 씁니다. 문장은 `fluent-korean` 스킬 기준을 따릅니다.
3. **출처**: 사실을 적은 페이지는 끝에 "출처" 절을 두고 근거 파일 경로나 URL과 commit을 적습니다. 근거가 없는 주장은 적지 않습니다.
4. **충돌**: 새 자료가 기존 내용과 다르면 바로 덮어쓰지 않습니다. 어느 쪽이 최신 근거인지 적고 고치며, 고정 결정을 바꾸는 경우에는 report.md에 근거가 있어야 합니다.
5. **목록**: 페이지를 만들거나 지우면 이 파일의 "위키 페이지" 표를 같은 작업에서 고칩니다.
6. **기록**: 위키를 바꾸는 모든 작업은 [log.md](log.md) 맨 아래에 `## [YYYY-MM-DD] <kind> | <title>` 항목을 추가합니다. `kind`는 `init`, `ingest`, `query`, `lint`, `decision` 중 하나입니다. 기존 항목은 고치지 않습니다.
7. **점검(lint)**: 게이트가 끝날 때마다 깨진 상대 링크, 목록에 없는 페이지, 페이지 사이의 모순, 낡은 내용을 점검합니다.
8. **보안**: API 키, 토큰, `.env` 값은 위키에 적지 않습니다.
