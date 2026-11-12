# 개발 도구 적용법

> G0 산출물입니다. 각 도구의 공식 저장소를 2026-11-13에 clone해서 읽고, PR-SIM에 어떻게 쓸지 정했습니다. 역할과 게이트 이름은 [run.md](../dev-harness/v1/run.md)를 따릅니다.

## 공통 사항

- 모든 스킬은 프로젝트 범위로만 설치했습니다: `.claude/skills/<이름>/`. 전역 설치, 플러그인 설치, 훅 설치, 저장소의 설치 스크립트 실행은 하지 않았습니다.
- 각 스킬 폴더의 `SOURCE.txt`에 출처 URL, commit, 라이선스, 원문에서 바꾼 부분을 적었습니다. `LICENSE`도 함께 복사했습니다.
- **Claude 에이전트**: 저장소 루트(`/Users/jyl/work/study/pr-sim`)에서 실행해야 `Skill` 도구에 프로젝트 스킬이 보입니다. 스킬이 보이지 않으면 해당 `SKILL.md`를 Read로 읽고 그대로 따릅니다.
- **Codex CLI**: Codex에는 프로젝트 스킬을 설치하지 않았습니다. 프롬프트와 함께 `SKILL.md`를 stdin으로 넘깁니다. `codex exec`는 인자 프롬프트와 stdin이 함께 있으면 stdin을 `<stdin>` 블록으로 붙입니다.

  ```sh
  codex exec -m gpt-6-astra -s read-only -C /Users/jyl/work/study/pr-sim \
    -o .verify/<gate>-<name>.md \
    "<작업 지시>. <stdin> 블록의 지침을 따른다." < .claude/skills/<스킬>/SKILL.md
  ```

| 도구 | 설치한 스킬 | 주 사용 역할 | 게이트 |
|---|---|---|---|
| fluent-korean | `fluent-korean` | Docs, UI Builder, Feature Builder(프롬프트) | G0~G3 |
| ponytail | `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt` | Builder, Code Critic | G1~G3 |
| no-ai-slop | `no-ai-slop` | Docs, Visual Critic | G2, G3 |
| hallmark | `hallmark` (audit와 sloplint만 사용) | Visual Critic | G2, G3 |
| gauntlet-loop | `gauntlet-loop` | Orchestrator | G1~G3 |
| LLM Wiki | `llm-wiki` | Docs | 전 게이트 |

---

## fluent-korean

- **출처**: https://github.com/snflkd/fluent-korean · commit `ce8683f0eba8cddb91de4dcd151425ff73e60498` · MIT
- **하는 일**: Claude Code output-style입니다. 조사·어미 생략, 명사 나열, 비유 어휘, 엠대시 남용을 막아서 의미가 분명한 한국어 문장을 쓰게 합니다. 코드, 변수명, 주석, 커밋 메시지, 로그 문자열에는 적용하지 않습니다.
- **설치**: output-style 원문(`fluent-korean.md`, 코딩 지침 유지판)을 `.claude/skills/fluent-korean/SKILL.md`로 감쌌습니다. frontmatter만 바꾸고 본문은 원문 그대로 두었습니다. README의 선택 블록 중 "모든 한국어 결과물에 적용"과 "출력 직전 점검" 두 줄만 덧붙였습니다. 세션의 `outputStyle` 설정은 바꾸지 않았습니다.
- **PR-SIM 적용**
  - Docs: `docs/wiki/**`, `docs/dev-v1/report.md`를 쓰기 전에 `Skill(fluent-korean)`을 불러옵니다.
  - UI Builder: 메뉴, 버튼, 안내 문구, 오류 메시지 같은 화면 문구를 쓸 때 불러옵니다. 문구 길이는 시안(`docs/screens/draft/*.png`)에 맞춥니다.
  - 심사위원 대사: 질문·피드백·리포트를 만드는 서버 프롬프트에 원문 전체를 넣지 않습니다(요청마다 토큰이 늘어납니다). G1 `question`, `report` PoC의 실제 출력 샘플을 이 기준으로 검토하고, 같은 결함이 반복되면 해당 조항을 예시와 함께 시스템 프롬프트에 넣습니다. 넣은 조항과 전후 비교는 `report.md`에 기록합니다.
  - Codex: `... "화면 문구를 고친다. 한국어 문장은 <stdin>의 지침을 따른다." < .claude/skills/fluent-korean/SKILL.md`
- **한계**: 작업이 길어지면 지침이 덜 지켜집니다. 그래서 원문 README도 주요 산출물에 대해 별도 검증을 권합니다. PR-SIM에서는 no-ai-slop 검사와 Critic 검토가 그 역할을 합니다. 원문은 요약하지 말라고 하므로, 시스템 프롬프트에 넣을 때도 예시를 지우지 않습니다.

## ponytail

- **출처**: https://github.com/DietrichGebert/ponytail · commit `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846` · MIT
- **하는 일**: 문제를 푸는 가장 작은 변경을 고르게 합니다. 순서는 "필요한가 → 코드베이스에 이미 있는가 → 표준 라이브러리·플랫폼 기능 → 설치된 의존성 → 한 줄 → 최소 구현"입니다. 신뢰 경계의 검증, 데이터 손실 방지, 보안, 접근성은 줄이지 않습니다. 분기·파서·보안 로직에는 작은 테스트를 하나 남기게 합니다.
- **설치**: `skills/` 중 `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`의 `SKILL.md`를 원문 그대로 복사했습니다. `ponytail-gain`(벤치마크 홍보), `ponytail-help`, Node 훅, band/board UI는 설치하지 않았습니다.
- **PR-SIM 적용**
  - UI Builder, Feature Builder: G1 PoC 수정과 G2 구현을 시작할 때 `Skill(ponytail)`을 불러옵니다(기본 `full`). 의도적으로 줄인 부분에는 `// shortcut: <한계>, <다시 볼 조건>` 주석을 남깁니다.
  - Code Critic(Codex `gpt-6-astra`): G1, G2 변경마다 리뷰합니다.

    ```sh
    codex exec -m gpt-6-astra -s read-only -C /Users/jyl/work/study/pr-sim \
      -o .verify/g2-ponytail-review.md \
      "Review the uncommitted changes under app/ following <stdin>." \
      < .claude/skills/ponytail-review/SKILL.md
    ```
  - G3 "불필요 UI·코드 제거": `ponytail-audit`으로 `app/` 전체를 점검하고, `ponytail-debt`로 `shortcut:` 주석 목록을 만듭니다. 호출 형식은 위와 같고 스킬 파일만 바꿉니다.
  - 판정: 결과의 Must fix는 P0/P1, Should fix는 P1 또는 P2, Nice to have는 P2로 옮깁니다.
- **한계**: 리뷰 출력은 원문대로 쉬운 영어입니다. `.verify/` 결과는 영어로 두고, `report.md`에 옮길 때 한국어로 요약합니다. `ponytail-debt`는 `git grep`을 쓰므로 저장소 루트에서 실행합니다. 원문 벤치마크 수치는 검증하지 않았습니다.

## no-ai-slop

- **출처**: https://github.com/petergyang/no-ai-slop · commit `000650b156983f5159695b441477f4e63b25dc85` · MIT
- **하는 일**: AI 글투 패턴 20여 가지를 찾아 고칩니다. 예: "X가 아니라 Y다" 식 대비, 서두 군말, "아무도 말하지 않는", 콜론으로 터뜨리는 결론, 과장된 중요성, 출처 없는 "전문가들은", 그럴듯한 마무리 한 줄. 두 가지 모드가 있습니다. Edit는 글쓴이의 말투를 살린 채 최소한으로 고치고, Detect는 고치지 않고 해당 문장을 인용해 패턴 이름만 붙입니다.
- **설치**: `SKILL.md`, `eval.md`를 원문 그대로 복사했습니다. Codex 플러그인(`.codex-plugin`)은 설치하지 않았습니다.
- **PR-SIM 적용**
  - Visual Critic, Docs: G2와 G3에서 화면 문구, 심사위원 질문·피드백 샘플, 리포트 문장을 Detect 모드로 검사합니다. 호출: `Skill(no-ai-slop)` 후 "is this slop? <추출한 문구>". 결과는 `.verify/`에 저장합니다.
  - 고칠 때는 no-ai-slop의 Edit 모드에 fluent-korean을 함께 적용합니다. 심사위원 페르소나의 말투는 "글쓴이의 목소리"로 보고 보존합니다.
  - Codex: `codex exec ... "Detect mode. 아래 문구를 검사한다: ..." < .claude/skills/no-ai-slop/SKILL.md`
- **한계**: 금지 어휘 목록과 예시는 영어입니다. 한국어에는 구조 패턴(대비, 군말, 과장, 출처 없는 주장, 마무리 한 줄)만 그대로 쓰고, 어휘 목록은 비슷한 한국어 표현을 판단해서 적용합니다. 글이 AI가 쓴 것인지 판정하는 도구가 아닙니다.

## hallmark

- **출처**: https://github.com/Nutlope/hallmark · commit `04977e15f3dfd6ee4b74c887dac3eb52665d6c92` · MIT
- **하는 일**: 새 웹페이지를 "생성된 티가 나지 않게" 만드는 디자인 스킬입니다. 테마 50종으로 페이지를 짓고, `sloplint`로 기계적 흔적을 검사합니다. 검사 등급은 Floor(어기면 출시 불가: 대비, focus, reduced motion, 지어낸 수치, 모바일 레이아웃 깨짐), Reflex(이유가 있으면 기록 후 예외), Finish(차단하지 않는 세부)입니다.
- **설치**: `skills/hallmark`를 복사했습니다. 테마 미리보기 이미지(`references/themes/*.jpg`, 5.6MB), 테스트 픽스처, `*.test.mjs`는 뺐습니다. `install.mjs`, `install-hook.mjs`, `imagegen.mjs`는 실행하지 않았습니다. `sloplint.mjs`의 import가 `node:fs`, `node:path` 같은 로컬 모듈뿐인 것을 확인했습니다.
- **PR-SIM 적용**
  - **빌드에는 쓰지 않습니다.** 디자인 기준은 시안 7종과 `docs/screens/draft/DESIGN.md`로 이미 고정되어 있습니다. hallmark도 잠긴 DESIGN.md가 있으면 그것을 따르라고 정합니다. 테마 선택, Picks 블록, CSS 스탬프, `.hallmark/log.json`은 쓰지 않습니다.
  - Visual Critic이 G2 화면과 G3 최종 화면에 정적 검사를 돌립니다.

    ```sh
    node .claude/skills/hallmark/scripts/sloplint.mjs app/src --scope app
    ```
    필요하면 `/hallmark audit app/src`로 판정형 게이트까지 봅니다. audit는 파일을 고치지 않습니다.
  - 판정: DESIGN.md·시안과 충돌하는 항목은 무시합니다. 무시하는 항목은 gate 20(Hallmark 스탬프), gate 63 중 브랜드 표기 `PR·SIM`의 가운뎃점입니다. Floor 중 접근성 항목(focus-visible, 대비, reduced motion, 가로 넘침)은 P1입니다. 나머지 FAIL과 REFLEX는 P2 후보로 두고 시안과 비교해 결정합니다.
  - 확인 결과(2026-11-13): `pocs/ui`에 정적 검사를 실행해 24개 파일에서 FAIL 41, REFLEX 17, WARN 3이 나왔습니다. 예: `Timer.tsx`의 `transition-[width]`(10a), `Landing.tsx` 제목 위 eyebrow(54), `Results.tsx`의 가운뎃점 메타 문자열(63). 실행해도 프로젝트에 파일이 생기지 않았습니다.
- **한계**: 렌더 검사(`--render --url http://localhost:3000/<route>`)는 `puppeteer-core`와 Chrome이 필요하고 아직 실행하지 않았습니다. `pocs/node_modules`에 `puppeteer-core`가 있으므로 `HALLMARK_PUPPETEER`로 지정할 수 있는지는 G2에서 확인합니다. 마케팅 랜딩 페이지를 기준으로 만든 규칙(약 80단어 제한, 히어로 규칙)은 앱 화면에 맞지 않을 수 있으므로 `--scope app`을 씁니다.

## gauntlet-loop

- **출처**: https://github.com/robonuggets/gauntlet-loop · commit `9b1975a1b8f01981f3f1e6b667ad3aaf907178ea` · CC BY 4.0 (스킬 Jay E/RoboNuggets, 기법 Matt Shumer)
- **하는 일**: 목표 하나를 "반복 루프 프롬프트"로 바꿉니다. 실제로 가져올 수 있는 기준물(bar)을 정하고, 작업을 작은 조각으로 나누고, 조각마다 Builder와 별도 Critic을 돌립니다. Critic은 새 컨텍스트에서 결과물과 기준물을 라벨 없이 나란히 놓고 어느 쪽이 나은지 하나만 고르며, 가장 큰 차이 하나를 Builder에게 돌려줍니다. 점수를 매기지 않고, 정해진 반복 횟수로 끝내지 않습니다.
- **설치**: `SKILL.md`를 원문 그대로 복사했습니다.
- **PR-SIM 적용**: run.md의 "구현자와 검증자는 항상 다른 에이전트" 원칙을 이 루프로 실행합니다. 원문의 `/loop`, `ultracode`는 쓰지 않고, Orchestrator가 워크플로 단계로 루프를 돌립니다.

  | 대상 | 기준물(bar) | Builder | Critic |
  |---|---|---|---|
  | G2·G3 화면 | `docs/screens/draft/0N-*.png`, 같은 390×844 뷰포트 스크린샷 | UI Builder | Visual Critic (`claude -p`) |
  | G1·G2 기능 | run.md 게이트 조건 + 실제 API 응답·입출력 | Feature Builder | Code Critic (Codex `gpt-6-astra`) |

  - 블라인드 비교: 스크린샷과 시안 파일을 A/B로 이름을 바꾸고 순서를 섞어 넘깁니다. Critic의 답은 "A 또는 B"와 가장 큰 차이 하나입니다.
  - 루프 프롬프트가 필요하면 `Skill(gauntlet-loop)`에 목표와 기준물을 함께 주고, 나온 프롬프트에서 마지막 두 줄을 원문의 "다른 에이전트용" 문장으로 바꿉니다.
  - 종료: Critic이 우리 결과를 고르거나 Orchestrator가 멈출 때입니다. 남은 차이는 run.md의 P2 목록에 적습니다.
- **한계**: 반복 횟수 상한이 없어서 비용이 쌓일 수 있습니다. Gemini는 무료 등급이라 하루 호출 수가 매우 적으므로, STT·TTS가 걸린 루프는 반복할 때 `pocs/fixtures`의 녹음·결과를 쓰고 실제 Gemini 호출은 마지막 확인에만 씁니다. 429 응답은 코드 결함이 아니라 제한으로 기록합니다.

## LLM Wiki (Karpathy)

- **출처**: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f · gist commit `ac46de1ad27f92b28ac95459c782c07f6b8c964a`
- **하는 일**: RAG처럼 질문할 때마다 원문을 다시 찾지 않고, LLM이 마크다운 위키를 계속 고쳐 가며 지식을 쌓는 방식입니다. 세 층(변하지 않는 원천 자료, LLM이 관리하는 위키, 규칙을 정한 스키마)과 세 작업(ingest, query, lint)으로 이루어집니다. `index.md`는 내용 목록, `log.md`는 `## [날짜] 종류 | 제목` 형식의 append-only 기록입니다.
- **설치**: `.claude/skills/llm-wiki/SKILL.md`에 PR-SIM용 운영 절차를 새로 쓰고, gist 원문은 `references/llm-wiki.md`에 보관했습니다.
- **PR-SIM 적용**
  - 원천 자료: `docs/prompts/`, `docs/screens/`, run.md, report.md, 코드, `.verify/` 결과.
  - 위키: `docs/wiki/`. 스키마: [index.md](index.md)의 "운영 규칙" 절. 문서를 새로 늘리지 않으려고 CLAUDE.md나 AGENTS.md를 따로 만들지 않았습니다.
  - Docs 역할이 게이트를 통과할 때마다 `Skill(llm-wiki)`로 ingest를 하고, 각 게이트 끝에 lint를 합니다. 기록은 [log.md](log.md)에 남깁니다.
- **한계**: Obsidian, qmd 같은 검색 도구는 쓰지 않습니다. 페이지가 수십 개를 넘기 전까지는 index.md로 충분합니다. gist는 개념 문서라서 세부 규칙은 index.md에서 정했습니다.

## 출처

- 저장소 clone 위치(작업용, 커밋 안 함): 세션 scratchpad `tools/<이름>`
- [run.md](../dev-harness/v1/run.md) 역할·게이트 정의
