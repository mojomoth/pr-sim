---
name: llm-wiki
description: PR-SIM의 docs/wiki/ 를 Karpathy LLM Wiki 방식으로 관리합니다. 새 자료를 위키에 반영(ingest)하거나, 위키를 근거로 답하거나(query), 위키 상태를 점검(lint)할 때 사용합니다. Docs 역할 전용입니다.
---

# LLM Wiki (PR-SIM)

원문 아이디어: `references/llm-wiki.md` (Karpathy gist). 위키의 구조와 규칙은 `docs/wiki/index.md`의 "운영 규칙" 절이 기준입니다. 이 파일과 index.md가 다르면 index.md를 따릅니다.

## 세 층

- 원천 자료: `docs/prompts/`, `docs/screens/`, `docs/dev-harness/v1/run.md`, `docs/dev-v1/report.md`, 코드, `.verify/` 결과. 위키 작업에서는 읽기만 하고 고치지 않습니다.
- 위키: `docs/wiki/*.md`. 이 스킬을 쓰는 에이전트가 씁니다.
- 스키마: `docs/wiki/index.md`의 "운영 규칙" 절.

## 작업

1. **Ingest**: 원천 자료를 끝까지 읽고, 관련 위키 페이지를 고치거나 새로 만듭니다. 각 페이지 끝의 "출처" 목록에 근거 파일 경로(필요하면 커밋)를 적습니다. 기존 내용과 충돌하면 지우지 말고 "충돌" 항목으로 남깁니다. 그다음 `index.md` 목록을 갱신하고 `log.md` 맨 아래에 항목을 추가합니다.
2. **Query**: `index.md`를 먼저 읽고 해당 페이지로 들어가 답합니다. 다시 쓸 만한 답은 새 페이지로 저장하고 ingest와 같이 기록합니다.
3. **Lint**: 페이지 사이의 모순, 새 자료로 낡은 주장, 어디에서도 링크되지 않은 페이지, 깨진 상대 링크, index.md에 빠진 페이지를 찾아 고치고 log.md에 `lint` 항목을 남깁니다.

## log.md 형식

append-only입니다. 기존 항목은 고치지 않습니다.

```
## [YYYY-MM-DD] <kind> | <title>
- 바뀐 파일: ...
- 근거: ...
```

`kind`는 `init`, `ingest`, `query`, `lint`, `decision` 중 하나입니다. 최근 항목 확인: `grep "^## \[" docs/wiki/log.md | tail -5`

문장은 `fluent-korean` 스킬 기준으로 씁니다. 키 값·토큰은 위키에 절대 적지 않습니다.
