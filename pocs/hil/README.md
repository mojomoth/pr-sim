# hil — HIL 검증 체크리스트 + 최종 통합 (`pocs/hil`)

PoC 7개(ui, stt-tts, wiki, judge, slide, question, report)와 공용 fixtures를 사람이 직접 검증(Human in the Loop)할 수 있도록 한 화면에 모은 페이지입니다. final 통합 에이전트가 만들었고, 통합 검증(타입체크, 린트, 빌드, 라우트 스모크)도 이 폴더의 테스트로 했습니다.

- 웹: **http://localhost:3100/hil**
- 개발 관측: http://localhost:3100/devlog (poc = `hil`, agent = `final`)

## 화면 구성

1. **전체 진행**: 체크한 항목 수 / 전체 64개, 판단한 PoC 수 / 8.
2. **PoC 바로가기**(상단 고정 칩): PoC별 체크 진행률.
3. **AI 제공자 상태**: Claude·OpenAI·Gemini에 짧은 요청을 1회씩 보내 지금 쓸 수 있는지 보여 줍니다. '다시 확인'으로 강제 재확인.
4. **PoC 현황**: 리뷰 판정, 남은 이슈 수, 내 진행률·판단.
5. **결정이 필요한 사항**: 여러 PoC에 걸친 제품·기술 결정 7개(결제, 기본 모델, STT 방식, TTS, 비용·대기 시간, 저장소, 실기기).
6. **PoC 카드**(8개): 열기 버튼, 요구사항, 한 단락 요약, 리뷰 이력, 바로가기 링크, 남은 이슈, **해 볼 것**(체크박스, 항목별 화면 링크), PoC별 결정 사항, 알려진 한계(접기), **내 판단**(좋아요/수정 필요/보류), **피드백** 입력.
7. **하단 고정 바**: 피드백 복사(Markdown, 클립보드), JSON 다운로드, 초기화.

체크·판단·피드백은 브라우저 `localStorage`(`prsim-hil-v1`)에 저장합니다. 모든 접근을 try/catch로 감쌌고, 저장이 막힌 브라우저(시크릿 창 등)에서는 메모리에서만 동작하며 경고 문구를 보여 줍니다. 다른 탭에서 바꾸면 `storage` 이벤트로 동기화됩니다.

## 아키텍처

```
app/hil/page.tsx (서버, metadata) ──▶ hil/components/HilChecklist.tsx (client)
                                        ├─ hil/lib/pocs-data.ts   PoC별 내용(순수 데이터: 요약, 판정, 남은 이슈, 단계, 한계, 결정)
                                        ├─ hil/lib/store.ts       localStorage 스토어 (useSyncExternalStore, SSR 스냅샷은 빈 상태)
                                        └─ hil/components/ProviderStatus.tsx ──GET /api/hil/providers──▶ hil/lib/providers.ts (server-only)
                                                                                                         claude-haiku-5-5 / gpt-5.4-nano / gemini-3.5-flash-lite 에 "Reply with OK." 1회
                                                                                                         60초 캐시 + 동시 요청 1개로 합침, 20초 타임아웃, 재시도 없음
```

- `pocs-data.ts`의 내용은 각 PoC README와 `devlog/events.jsonl`의 review/fix 기록에서 정리했습니다. PoC가 바뀌면 이 파일만 고치면 됩니다.
- 사용 모델: 제공자 상태 확인에만 가장 싼 모델을 씁니다. 응답 내용은 쓰지 않고 성공/실패와 HTTP 상태만 봅니다. 오류 메시지는 한국어 사유로 바꾸고 원문(키 일부가 섞일 수 있음)은 클라이언트로 보내지 않습니다.
- 디자인: DESIGN.md 토큰(흰 캔버스, 회색 surface 카드 28px, 검정 주요 버튼 56px/20px, 칩 999px, 탭 영역 44px 이상, Pretendard, tabular 숫자). 상태는 색과 함께 글자(통과/확인 필요, 사용 가능/불가)로 표시합니다. 로고는 승인된 검정 lockup(`public/hil/lockup-black.png`, ui PoC가 다듬은 파일의 사본).

## 라우트 / API

| 경로 | 설명 |
|---|---|
| `/hil` | HIL 체크리스트 페이지 |
| `GET /api/hil/providers[?force=1]` | `{checkedAt, cached, providers:[{id,label,model,ok,ms,status,reason}]}` |

## 재사용 lib API

- `POC_ITEMS`, `GLOBAL_DECISIONS`, `UPDATED_AT` (`@/hil/lib/pocs-data`): 다른 화면(허브, 문서 생성)에서 그대로 쓸 수 있는 순수 데이터.
- `checkProviders(force?)` (`@/hil/lib/providers`, server-only): 실제 앱의 헬스 체크나 폴백 경로 선택에 쓸 수 있습니다.
- `useHilState()`, `updatePoc(key, fn)`, `resetAll()` (`@/hil/lib/store`): 작은 localStorage 스토어 패턴.

## HIL 체크리스트 (이 페이지 자체)

1. http://localhost:3100/hil 을 휴대폰과 데스크톱에서 엽니다. AI 제공자 카드에 세 제공자 상태가 나오는지 봅니다(충전 후 '다시 확인'으로 바뀌는지).
2. 각 PoC 카드의 '열기'로 새 탭에서 PoC를 열고, '해 볼 것'을 하나씩 해 보며 체크합니다.
3. PoC마다 '내 판단'을 고르고 피드백을 적습니다. 새로고침해도 남아 있는지 봅니다.
4. 다 끝나면 '피드백 복사'로 Markdown을 복사해 전달합니다(또는 JSON 다운로드).
5. '결정이 필요한 사항' 7개에 대한 결정을 피드백에 함께 적어 주세요.

## 검증 기록 (2026-11-13)

| 항목 | 명령 (pocs/에서) | 결과 |
|---|---|---|
| 전체 타입체크 | `pnpm exec tsc --noEmit` | 오류 0 |
| 전체 린트 | `pnpm exec eslint .` | 처음엔 오류 223건이었는데 모두 생성물(`.verify/wiki/review/chunks/*.js`, `public/**/pdfjs/**`, `*.min.mjs`)이었음 → `eslint.config.mjs` globalIgnores에 `.verify/**`, `.data/**`, `public/**/pdfjs/**`, `public/**/*.min.mjs` 추가 → **오류 0, 경고 5**(다른 PoC 소유, 그대로 둠) |
| hil 파일 타입·린트 | `tsc … \| grep hil`, `eslint hil app/hil app/api/hil` | 0 / 0 |
| 프로덕션 빌드 | `pnpm exec next build` | 성공(약 6초, 실행 중인 dev 서버와 충돌 없음). 페이지 19 + API 37. NFT 경고 6건(동적 fs 경로: judge/lib/store.ts:42·85, report/lib/sessions.ts:77·82, ui/lib/fixture.ts:11, wiki/lib/http.ts:13) |
| 라우트 스모크 (모바일 390×844) | `node hil/tests/smoke.mjs` | 19/19: 모두 HTTP 200, 콘솔 오류 0, 가로 넘침 0. 스크린샷 `.verify/final/*.png`, 모음 `.verify/final/contact-mobile.png`, 결과 `.verify/final/smoke.json` |
| 라우트 스모크 (데스크톱 1280) | `node hil/tests/smoke.mjs --desktop` | 19/19 같은 기준 통과. `.verify/final/*-desktop.png`, `smoke-desktop.json` |
| HIL 페이지 E2E | `node hil/tests/hil-page.mjs` | **22/22 PASS**: 모바일·데스크톱 200(약 1초), 제공자 카드, 8개 카드, 결정 사항, 넘침 0, 체크 2개·판단·피드백 → 새로고침 후 복원, 상단 칩 2/10, 전체 진행 '체크 2 / 64 · 판단 1 / 8', Markdown 복사 내용, 초기화, localStorage 접근이 예외를 던질 때 경고 + 메모리 동작 + pageerror 0, 콘솔 오류 0. `.verify/hil/*.png`, `hil-page.json` |
| 제공자 프로브 | `node --env-file=.env.local hil/tests/provider-probe.mjs` | Claude 400 사용 한도(12/1 복구), OpenAI 429 크레딧 0, Gemini flash-lite 200(1.7초). `.verify/hil/provider-probe.json`. `/api/hil/providers`도 같은 결과(캐시 HIT 즉시) |

스크린샷을 직접 열어 확인했습니다: `.verify/hil/mobile-top.png`, `mobile-ui-card.png`, `desktop-top.png`, `desktop-crop-decisions.png`, `.verify/final/contact-mobile.png`.

## 알려진 한계

- 체크·피드백은 브라우저별 저장이라 여러 사람이 함께 쓰려면 'JSON 다운로드'나 'Markdown 복사'로 모아야 합니다. 서버 저장은 하지 않았습니다.
- `pocs-data.ts`는 손으로 정리한 스냅샷입니다(기준일 2026-11-13). PoC가 바뀌어도 자동으로 갱신되지 않습니다.
- 제공자 확인은 호출할 때마다 Gemini 무료 등급 1회를 씁니다(60초 캐시로 줄임). 모델별 한도는 이 3개 모델로만 확인하므로, 다른 모델(예: gemini-3.8-flash-tts)의 한도 소진은 여기서 보이지 않습니다.
- dev 서버(Turbopack)가 새 `app/api/hil` 디렉터리를 처음엔 404로 응답했고, 두 번째 요청부터 정상이었습니다(ui PoC가 겪은 것과 같은 워처 지연).

## 다음 단계

- HIL 피드백을 받으면 PoC별 수정 라운드를 돌리고 `pocs-data.ts`의 판정·남은 이슈를 갱신합니다.
- 실제 앱 착수 전: 결제 해결 → Claude 경로 회귀 테스트(wiki·question·report) → ui 화면에 stt-tts·slide·judge·question·report를 실제로 연결하는 통합 PoC.
- `next build` NFT 경고 4개 파일의 동적 경로 정리, 공용 `scripts/browser.mjs`에 `--disable-features=AudioServiceSandbox` 추가(호스트 소유자 결정).
