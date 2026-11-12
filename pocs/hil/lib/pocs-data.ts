// HIL checklist content for every PoC. Pure data (no server/client deps) so the page, tests and README can share it.
// Sources: each PoC's README.md, the review/fix rounds recorded in devlog/events.jsonl, and the final integrator's checks.

export type Tone = "pass" | "warn" | "fail";

export type HilStep = { id: string; text: string; href?: string };

export type HilPoc = {
  key: string;
  title: string;
  /** 사용자 요구사항 원문 요약 */
  requirement: string;
  href: string | null;
  links: { label: string; href: string }[];
  readme: string;
  summary: string;
  verdict: { label: string; tone: Tone };
  /** 리뷰·수정 이력 한 줄 */
  trail: string;
  remaining: string[];
  steps: HilStep[];
  limitations: string[];
  decisions: string[];
};

export const UPDATED_AT = "2026-11-13";

export const POC_ITEMS: HilPoc[] = [
  {
    key: "ui",
    title: "UI 개발",
    requirement: "docs/screens/draft 시안 구현, /ui 아래 경로로 접근",
    href: "/ui",
    links: [
      { label: "화면 인덱스 + 시안 비교", href: "/ui/screens" },
      { label: "상황 설정", href: "/ui/setup" },
      { label: "발표 (12초 버전)", href: "/ui/presentation?sec=12" },
      { label: "심사 (40초 버전)", href: "/ui/review?sec=40" },
    ],
    readme: "pocs/ui/README.md",
    summary:
      "DESIGN.md와 시안 7종을 기준으로 랜딩 → 상황 설정 → 발표 → 심사 → 종합 결과 → 상세 피드백 → 목록 7개 화면을 만들었습니다. 업로드한 PDF를 pdf.js로 렌더링하고, 카메라·마이크 파형, 문장별 전사 말풍선(목업), 남은 시간 타이머와 0초 자동 전환까지 실제처럼 동작합니다. 점수·질문·전사 데이터는 목업이며 AI는 호출하지 않습니다. 심사위원·랜딩 사진은 gpt-image-2로 한 번 생성해 두었습니다.",
    verdict: { label: "리뷰 통과 (3차)", tone: "pass" },
    trail: "리뷰 1차 fail(세로 PDF 과확대) → 수정 → 2차 fail(로고) → 수정 → 3차 PASS · E2E 40/40, fix-r2 85/85",
    remaining: [
      "/ui/screens의 01 시안 썸네일이 옛 흰색 랜딩입니다(ui/scripts/sync-drafts.sh 재실행 필요).",
      "심사위원 5명일 때 결과는 '질문 5개'인데 상세 피드백은 고정 목업이라 '1 / 4'로 나옵니다.",
      "발표 화면에서 새로고침하면 타이머가 처음부터 다시 시작되고 업로드한 PDF 대신 샘플 PDF가 나옵니다.",
      "심사 화면의 목업 답변이 목업 질문 1번과 맞지 않습니다.",
      "←/→ 키는 슬라이드에 포커스가 있을 때만 동작합니다(클릭 또는 Tab 후).",
    ],
    steps: [
      { id: "ui-1", text: "/ui/screens에서 화면마다 왼쪽 시안 썸네일과 간격, 글자 크기, 모서리, 검정 버튼 인상을 비교합니다(휴대폰 또는 390×844).", href: "/ui/screens" },
      { id: "ui-2", text: "상황 설정에서 슬라이더를 드래그, −/+, 키보드로 바꿔 하단 '총 N분 · 심사위원 M명'이 바로 바뀌는지 봅니다.", href: "/ui/setup" },
      { id: "ui-3", text: "내 PDF를 발표 자료로 올려 파일명과 페이지 수가 맞는지, PDF가 아닌 파일은 '업로드 실패 · 다시 시도'가 뜨는지, 교체·삭제가 되는지 확인합니다." },
      { id: "ui-4", text: "심사위원을 추가·삭제하고 성향 칩이 한 명당 하나만 선택되는지, 발표 자료가 없으면 시작 버튼이 비활성되고 이유가 보이는지 확인합니다." },
      { id: "ui-5", text: "발표 화면에서 카메라를 허용하면 내 얼굴이, 거부하면 권한 안내와 '다시 시도'가 나오는지, 말할 때 파형이 움직이는지 봅니다." },
      { id: "ui-6", text: "슬라이드를 스와이프·버튼·←/→(슬라이드 클릭 후)로 넘기고, 크게 보기를 열었다가 Esc로 닫습니다." },
      { id: "ui-7", text: "발표 12초 버전으로 들어가 30초 미만 빨간 타이머, 0초에 '발표 시간이 끝났어요' 안내, 4초 뒤 심사 화면 이동을 확인합니다.", href: "/ui/presentation?sec=12" },
      { id: "ui-8", text: "심사 화면에서 질문 타이핑 중 '질문 중', 이어 검정 답변 말풍선, '답변 완료'로 심사위원이 순서대로 바뀌는지 봅니다." },
      { id: "ui-9", text: "결과 → 상세 피드백 → 기록으로 이동해 '방금' 기록, 필터, '다시 시작하기', '+ 새 시뮬레이션'을 눌러 봅니다." },
      { id: "ui-10", text: "데스크톱(1024px 이상)에서 설정·발표가 2열로 바뀌고 과하게 늘어나지 않는지, Tab 키만으로 흐름을 진행할 수 있는지 봅니다." },
    ],
    limitations: [
      "점수·피드백·질문·전사는 목업입니다. stt-tts / question / report PoC와 아직 연결하지 않았습니다.",
      "업로드 PDF는 메모리에만 있어 새로고침하면 사라집니다(메타만 sessionStorage).",
      "새로 추가한 심사위원은 얼굴 없이 이니셜로 나옵니다. 최대 5명은 임시 상한입니다.",
      "iOS Safari 실기기의 권한·safe-area는 확인하지 못했습니다(헤드리스 Chrome 가짜 장치로만 검증).",
    ],
    decisions: [
      "심사위원 최대 인원(현재 임시 5명)과 질문 수 규칙(현재 max(4, 심사위원 수))을 정해 주세요.",
      "PDF 업로드 용량 제한과 새로고침·이어하기 때 PDF 보존 방식(IndexedDB 캐시 vs 서버 저장)을 정해 주세요.",
    ],
  },
  {
    key: "stt-tts",
    title: "STT / TTS",
    requirement: "Gemini API로 STT·TTS 동작 확인. 문장별 전사, 페르소나(성별·연령·친절함/빡셈/공격적)별 음성",
    href: "/stt-tts",
    links: [],
    readme: "pocs/stt-tts/README.md",
    summary:
      "STT는 두 방식을 실측 비교해 Gemini Live(gemini-3.5-transcribe-live)에 브라우저가 1회용 토큰으로 직접 연결하는 방식(A)을 기본으로 정했습니다. 문장 확정까지 1.4~1.7초이고, 말하는 동안 글자가 실시간으로 바뀝니다. Live 연결이 실패하면 VAD로 구간을 잘라 전사하는 방식(B, 2.5~3.0초)으로 자동 전환합니다. 한국어 문장 분리기가 '다./요./까?', 소수점, 약어를 처리해 문장마다 말풍선을 만듭니다. TTS는 성별×성향×연령을 Gemini 프리빌트 음성 12종과 스타일 지시문으로 매핑하고 결과를 캐시합니다.",
    verdict: { label: "리뷰 통과 (1차) · 지적 4건 수정", tone: "pass" },
    trail: "리뷰 1차 PASS(minor 4) → 4건 모두 수정 · 문장 분리 단위 12/12, Live 회귀 7문장 평균 1.4초",
    remaining: [
      "Gemini 무료 등급 한도가 작습니다: TTS 모델별 하루 10회·분당 3회, 배치 전사 하루 25회. 한도가 끝나면 B 모드는 한도 안내만 보입니다.",
      "공용 scripts/browser.mjs의 가짜 마이크는 macOS에서 무음입니다(stt-tts는 자체 launch.mjs로 우회).",
    ],
    steps: [
      { id: "stt-1", text: "'마이크 켜고 전사 시작'을 누르고 마이크 권한을 허용합니다.", href: "/stt-tts" },
      { id: "stt-2", text: "한국어로 2~3문장을 문장 사이에 1초씩 쉬며 말합니다. 점선 말풍선('음성 인식 중')이 실시간으로 바뀌고, 쉬고 나서 약 1.5초 안에 문장마다 '인식 완료' 말풍선이 따로 생기는지 봅니다." },
      { id: "stt-3", text: "한 문장을 중간에 쉬면서 말합니다(예: '저희 서비스는 … 발표 연습을 돕습니다.'). 말풍선 하나로 합쳐지는지 봅니다." },
      { id: "stt-4", text: "'매출이 3.5배', 'A.I. 기술', '이 부분이 정말 중요합니다'처럼 말해 문장이 엉뚱하게 잘리지 않는지 확인합니다." },
      { id: "stt-5", text: "'전사 종료'를 눌렀을 때 말하던 마지막 문장이 확정되는지, '지우기'가 동작하는지 봅니다." },
      { id: "stt-6", text: "TTS: 성별·연령(20대/60대)·성향을 바꿔 '음성 생성'을 누르고, 귀로 들었을 때 성별·나이·말투 차이가 느껴지는지 판단합니다." },
      { id: "stt-7", text: "'3가지 성향 비교'로 같은 문장이 친절함 → 빡셈 → 공격적 순서로 재생되는지, 공격적이 무례하지 않은지 들어 봅니다." },
      { id: "stt-8", text: "같은 조건으로 다시 생성하면 캐시로 즉시 재생되는지, 연속으로 누르면 한도 안내가 한국어로 나오는지 봅니다." },
      { id: "stt-9", text: "브라우저에서 마이크 권한을 차단하고 시작해 빨간 안내와 '다시 시도'가 나오는지 확인합니다." },
    ],
    limitations: [
      "Live API와 에페메랄 토큰은 SDK에서 experimental(v1alpha)입니다. 세션 재연결(최대 5회)은 넣었지만 30분 이상 발표는 시험하지 않았습니다.",
      "문장 타임스탬프는 ±1초 근사값입니다.",
      "폴백 TTS 모델마다 같은 음성 이름이라도 음색이 조금씩 다릅니다.",
      "iOS Safari 실기기, TTS 재생과 STT 동시 사용 시 에코는 검증하지 않았습니다.",
    ],
    decisions: [
      "STT 기본 방식: Live(A, 1.4~1.7초, 중간 글자 표시, experimental API) vs VAD+배치 전사(B, 2.5~3초, 안정 API). 현재 A 기본 + B 자동 폴백입니다.",
      "Gemini 유료 등급 전환 여부: 무료 등급으로는 TTS 하루 10회라 실사용·HIL 반복이 어렵습니다.",
      "연령이 음성 선택에 주는 영향(현재 40세 경계에서 음성 교체 + 1세 단위 음높이·속도 지시)이 청감상 충분한지 판단해 주세요.",
    ],
  },
  {
    key: "wiki",
    title: "Context to Wiki",
    requirement: "큰 PDF를 Karpathy LLM Wiki 방식의 위키로 만들어 컨텍스트로 활용(업로드 파일 자체가 위키)",
    href: "/wiki",
    links: [],
    readme: "pocs/wiki/README.md",
    summary:
      "업로드한 PDF 하나를 위키 하나로 만듭니다. raw(원본 쪽별 텍스트, 불변) · wiki(서로 링크된 마크다운 페이지, index.md, log.md, overview, 주요-수치) · SCHEMA.md 세 층 구조입니다. 큰 PDF는 6~8쪽 청크로 나눠 병렬로 사실을 뽑고, 라운드마다 바뀌는 페이지만 갱신하며 진행 상황을 SSE로 보여 줍니다. queryWiki는 index에서 관련 페이지를 골라 문자 수 예산 안에서 (p.N) 출처가 붙은 컨텍스트를 만들고, lintWiki는 문서 간 수치 불일치(원가 142원 vs 118원, SOM 210억 vs 340억 등)를 찾습니다. question·report PoC가 이 API를 씁니다.",
    verdict: { label: "3차 리뷰 지적 수정 완료 · 재리뷰 없음", tone: "warn" },
    trail: "리뷰 1·2·3차 각각 major 1건 → 매번 수정. 마지막 수정('다시 만들기' 스테이징·원자적 교체 등 6건)은 모의 하네스 24/24로만 검증, 4차 리뷰는 하지 않음",
    remaining: [
      "'위키 다시 만들기' 성공 경로는 제공자 장애 때문에 실제 LLM으로 검증하지 못했습니다(모의 하네스로만 검증).",
      "지금 OpenAI 크레딧 0 + Claude 한도라 새 PDF 인제스트가 즉시 실패합니다. 질의는 어휘 선택 + 컨텍스트만, 점검은 결정적 항목만 동작합니다. 이미 만든 위키는 열람·인용 모두 정상입니다.",
    ],
    steps: [
      { id: "wiki-1", text: "위키 목록에 문서(12/58/128쪽)가 '완료'로 보이는지 확인합니다.", href: "/wiki" },
      { id: "wiki-2", text: "proposal.pdf의 overview를 읽고 '검토 포인트'가 심사위원 시각에서 쓸모 있는지 판단합니다. 본문의 [[링크]]로 페이지를 이동해 봅니다." },
      { id: "wiki-3", text: "p.N 칩을 눌러 원문 시트를 열고, 무작위로 3~4개 문장이 원문에 실제로 있는지 대조합니다." },
      { id: "wiki-4", text: "주요-수치 페이지에서 142원, 약 14%, SOM 210억, 20억이 맞는지, presentation.pdf에서는 118원, 28%, 340억이 맞는지 봅니다." },
      { id: "wiki-5", text: "질의 탭에서 '1공장 생산능력으로 2027년 매출 32억이 가능한가?'를 물어 계산 근거와 결론이 타당한지 봅니다. 예산 슬라이더를 1,500자로 줄여도 답이 유지되는지 확인합니다." },
      { id: "wiki-6", text: "점검 탭에서 proposal.pdf의 비교 문서로 presentation.pdf를 골라 원가·이익률·SOM 불일치 3건이 high로 나오는지 봅니다(LLM 필요)." },
      { id: "wiki-7", text: "제공자가 막힌 지금 상태에서 질의가 1~2초 안에 컨텍스트와 함께 '답변을 만들지 못했습니다' 한국어 카드를 보이는지 확인합니다." },
      { id: "wiki-8", text: "(크레딧 충전 후) 50쪽 이상 내 PDF를 올려 청크·라운드 진행이 실시간으로 바뀌는지, 결과 위키의 페이지 분할이 자연스러운지 판단합니다." },
      { id: "wiki-9", text: "(크레딧 충전 후) '위키 다시 만들기'를 눌러 진행 중에도 이전 위키로 질의가 계속 되다가 완료 시 새 위키로 바뀌는지 봅니다." },
    ],
    limitations: [
      "Claude 경로(haiku/sonnet/opus)는 실호출로 검증하지 못했습니다. 실제 검증은 OpenAI(gpt-5.4-mini, gpt-5.5, gpt-5.4-nano)로 했습니다.",
      "스캔 PDF는 OCR이 없어 거부합니다. 표·차트 이미지 안의 숫자는 텍스트 레이어에 있을 때만 들어옵니다.",
      "128쪽 인제스트에 약 4분이 걸리고, 끝나기 전에는 위키를 열 수 없습니다.",
      "LLM 출력이라 페이지 구조와 [불일치] 표시가 실행마다 조금씩 다릅니다.",
      "단일 Node 프로세스와 파일시스템(.data/wiki) 전제입니다.",
    ],
    decisions: [
      "인제스트 시점: 업로드 직후 백그라운드로 시작해 상황 설정 중에 끝내는 방식을 제안합니다. 128쪽 약 4분, 토큰 입력 48만·출력 23만 수준입니다.",
      "인제스트 모델: 현재 Claude 우선 → OpenAI 폴백. Claude 복구 후 haiku/sonnet 품질·비용 비교가 필요합니다.",
      "스캔 PDF OCR 지원 여부.",
    ],
  },
  {
    key: "judge",
    title: "심사위원 생성",
    requirement: "OpenAI API로 실사 얼굴 이미지를 랜덤 생성. 입력은 친절함/빡셈/공격적 세 가지뿐",
    href: "/judge",
    links: [],
    readme: "pocs/judge/README.md",
    summary:
      "사용자 입력은 성향 하나뿐입니다. 성별, 나이(32~64), 한국 이름, 헤어, 복장, 배경, 조명, 표정 변형은 서버가 매번 무작위로 정하고, gpt-image-2(quality low, 1024px)로 실사 헤드샷을 약 10초에 만듭니다. 성향은 표정과 태도에만 반영하고(공격적도 화난 얼굴 금지), '3명 한 번에'는 성·이름이 겹치지 않고 성별·나이가 섞이도록 미리 정한 뒤 병렬 생성합니다. 이미지·썸네일·메타데이터를 .data/judge에 저장합니다.",
    verdict: { label: "리뷰 통과 (2차)", tone: "pass" },
    trail: "리뷰 1차 fail(재생성 중복) → 8건 수정 → 2차 PASS(minor 4) · 실생성 9명 육안 검수",
    remaining: [
      "지금 OpenAI 크레딧이 0이라 새 얼굴 생성이 실패합니다. 기존에 생성한 갤러리는 볼 수 있습니다.",
      "리뷰 2차 minor 4건이 남아 있습니다(README 참고).",
    ],
    steps: [
      { id: "judge-1", text: "휴대폰·데스크톱 크기로 열어 기존 심사위원이 컬러로 보이는지 확인합니다.", href: "/judge" },
      { id: "judge-2", text: "실사 품질: 상세 시트에서 큰 사진을 보고 AI 티(손, 귀, 눈 비대칭, 글자)가 있는지 봅니다." },
      { id: "judge-3", text: "성향 표현: 친절함·빡셈·공격적이 얼굴만 보고 구분되는지, 공격적이 과하지 않은지 판단합니다." },
      { id: "judge-4", text: "(크레딧 충전 후) 성향을 골라 '생성'을 여러 번 눌러 성별, 나이, 이름, 복장, 배경이 매번 달라지는지 봅니다(약 10초)." },
      { id: "judge-5", text: "(크레딧 충전 후) '3명 한 번에 생성'으로 성과 이름이 겹치지 않고 성별·나이가 섞였는지 확인합니다." },
      { id: "judge-6", text: "'개발용 옵션'의 화질 보통(약 30초)/고화질(약 90초)이 low와 비교해 볼 만한 차이가 있는지 봅니다." },
      { id: "judge-7", text: "'오류 화면 미리보기'에서 moderation·rate_limit 오류 문구가 자연스러운지 봅니다." },
    ],
    limitations: [
      "moderation 차단과 rate limit은 시뮬레이션으로만 UI를 검증했습니다.",
      "저장소는 로컬 파일이고 인증·사용자 분리가 없습니다. 같은 사람을 다시 만들 수 없습니다(seed 없음).",
      "생성은 동기 요청(약 10초)이라 탭을 닫으면 취소되고 저장되지 않습니다.",
      "빡셈과 공격적은 사진만으로 구분이 애매할 수 있어 UI에 텍스트 태그를 반드시 붙입니다.",
    ],
    decisions: [
      "이미지 화질과 비용: low(약 10초) 기본 유지 vs medium/high. 심사위원 3명 생성을 발표 시작 전에 미리(startPanel, 약 12초) 할지 정해 주세요.",
      "심사위원 얼굴을 매 세션 새로 만들지, 갤러리에서 재사용할지 정해 주세요.",
    ],
  },
  {
    key: "slide",
    title: "Slide View",
    requirement: "업로드한 PDF를 좌/우 스와이프로 보여 주는 프론트엔드",
    href: "/slide",
    links: [
      { label: "샘플 발표자료", href: "/slide?sample=presentation" },
      { label: "샘플 제안자료 58쪽", href: "/slide?sample=proposal" },
      { label: "임베드 확인", href: "/slide/embed" },
    ],
    readme: "pocs/slide/README.md",
    summary:
      "pdf.js v6을 브라우저에서만 써서 업로드 PDF를 렌더링하는 재사용 컴포넌트 SlideViewer를 만들었습니다. 손가락을 따라오는 스와이프, 플릭, 양 끝 고무줄 저항, 세로 스크롤과의 구분, 키보드(←/→/Home/End/F/Esc), 썸네일, 더블탭·핀치 확대, 전체 화면, 트랙패드 가로 스와이프를 지원합니다. 렌더는 워커(OffscreenCanvas)에서 하고 이웃 쪽을 미리 그립니다. AI와 서버 키를 쓰지 않습니다.",
    verdict: { label: "리뷰 통과 (3차)", tone: "pass" },
    trail: "리뷰 1차 fail → 수정 → 2차 fail(핀치 축소 고정, 트랙패드 다중 넘김) → 수정 → 3차 PASS(minor 1) · E2E 52/52",
    remaining: ["스냅 애니메이션 중에 다시 잡으면 트랙이 목표 위치로 약 54px 튑니다(minor)."],
    steps: [
      { id: "slide-1", text: "휴대폰에서 샘플 발표자료를 열고 좌우로 스와이프합니다. 손가락을 따라오는지, 반쯤 넘기다 놓으면 되돌아오는지 봅니다.", href: "/slide?sample=presentation" },
      { id: "slide-2", text: "짧게 튕겨 넘어가는지, 1쪽과 마지막 쪽에서 고무줄처럼 저항하는지, 세로 스크롤 중에는 쪽이 넘어가지 않는지 확인합니다." },
      { id: "slide-3", text: "더블탭·핀치로 확대하고 끌어서 이동한 뒤 글자가 선명해지는지, 1배 아래로 오므렸다 놓으면 원래 크기로 돌아오는지 봅니다." },
      { id: "slide-4", text: "Mac 트랙패드로 두 손가락 가로 스와이프를 한 번 했을 때 정확히 한 쪽만 넘어가는지 봅니다." },
      { id: "slide-5", text: "샘플 제안자료(58쪽 A4)에서 첫 페이지가 바로 뜨는지, 빠르게 여러 장을 넘겨도 끊기지 않는지 확인합니다.", href: "/slide?sample=proposal" },
      { id: "slide-6", text: "내 PDF를 버튼과 끌어다 놓기로 올리고, PDF가 아닌 파일·깨진 PDF·암호 PDF에 한국어 오류가 나오는지 봅니다." },
      { id: "slide-7", text: "전체 화면에서 넘긴 뒤 닫고, 휴대폰을 가로로 돌려 다시 선명하게 그려지는지 봅니다." },
      { id: "slide-8", text: "/slide/embed에서 아무것도 누르지 않고 →를 누르면 두 뷰어 모두 그대로이고, 왼쪽을 클릭한 뒤 →는 왼쪽만 넘어가는지 봅니다.", href: "/slide/embed" },
    ],
    limitations: [
      "핀치·트랙패드는 합성 이벤트로만 검증했습니다. iOS Safari의 시스템 줌·뒤로 가기 스와이프 충돌은 실기기 확인이 필요합니다.",
      "텍스트 레이어를 그리지 않아 텍스트 선택·검색이 안 됩니다.",
      "확대 상태에서는 가장자리로 끌어도 다음 쪽으로 넘어가지 않습니다.",
      "dev 라우트 핸들러가 Content-Length 없이 응답해 큰 PDF URL은 Range 요청 대신 전체를 받습니다(업로드 파일은 해당 없음).",
    ],
    decisions: [
      "ui 발표 화면의 SlideStage를 SlideViewer로 교체할지(제안: 교체, 썸네일 끔).",
      "TranscriptSentence에 슬라이드 번호 필드를 추가해 '몇 쪽에서 무슨 말을 했는지'를 기록할지(report의 쪽별 분석에 필요).",
    ],
  },
  {
    key: "question",
    title: "심사 질문",
    requirement: "STT 전사·발표자료·제안자료로 심사위원 페르소나(친절함/빡셈/공격적)에 맞춰 질문",
    href: "/question",
    links: [],
    readme: "pocs/question/README.md",
    summary:
      "전사와 두 PDF 위키(wiki PoC의 queryWiki, 원본 105k자 중 약 25%만 사용)로 컨텍스트를 만들고, 검토 포인트를 심사위원에게 나눠 배정한 뒤 성향별 질문을 스트리밍으로 생성합니다(첫 질문 약 5~7초). 질문마다 원문 근거가 붙고, 6회 실행의 인용 72/72개가 원문과 일치했습니다. 의도된 약점 4종(원가 118↔142원, SOM 340↔210억, 성장·생산능력, 단일 공급처)을 모두 짚었고, 라벨 없이 질문만 보고 성향을 맞힌 비율이 93%입니다. 답변을 평가해 회피성이면 꼬리질문, 충분하면 다음 질문으로 넘어가며 심사위원 음성(TTS)과 마이크 답변(Live STT)까지 연결했습니다.",
    verdict: { label: "리뷰 통과 (3차)", tone: "pass" },
    trail: "리뷰 1차 fail(major 3) → 수정 → 2차 fail(재생 세션 꼬리질문 섞임) → 수정 → 3차 PASS(minor 6) · 근거 45/45 원문 일치",
    remaining: [
      "지금은 세 제공자 모두 막혀 있어(Claude 한도, OpenAI 크레딧 0, Gemini 무료 일일 한도) 새 질문 생성·꼬리질문·TTS가 실패할 수 있습니다. '저장된 실행 불러오기'로 질문·근거·질의응답 UI를 확인할 수 있습니다.",
      "리뷰 3차 minor 6건이 남아 있습니다(예: 제공자 장애 시 답변 기록 불가).",
    ],
    steps: [
      { id: "q-1", text: "샘플 상황·전사 46문장·심사위원 3명(이정민 친절함 / 박준호 빡셈 / 최태성 공격적)이 미리 채워져 있는지 확인합니다.", href: "/question" },
      { id: "q-2", text: "'질문 생성'을 누릅니다(막히면 '저장된 실행 불러오기'). 단계 로그와 심사위원별 스트리밍, 첫 글자·첫 질문·전체 시간을 봅니다." },
      { id: "q-3", text: "성향 차이가 확실한지 읽어 봅니다(친절함: 칭찬 + 열린 질문, 빡셈: 수치 요구, 공격적: 압박). 공격적이 무례하지 않은지 봅니다." },
      { id: "q-4", text: "'근거 N개'를 펼쳐 p.N 링크로 2~3개를 원본 PDF와 대조하고, 118원/142원·340억/210억 불일치를 짚는 질문이 있는지 봅니다." },
      { id: "q-5", text: "컨텍스트 인스펙터에서 섹션별 크기, 검토 포인트와 담당 심사위원, 전체 프롬프트를 확인합니다." },
      { id: "q-6", text: "휴대폰에서 '질의응답 시작'을 눌러 타이머·심사위원·질문·답변 칸으로 바로 이동하는지, 심사위원 음성이 재생되는지 봅니다." },
      { id: "q-7", text: "회피성 답변('기준이 좀 달라서요…')을 넣으면 같은 심사위원이 꼬리질문을 하는지, 근거 있는 답변('현재 원가는 142원이 맞고…')은 '충분'으로 다음으로 넘어가는지 봅니다." },
      { id: "q-8", text: "마이크로 말해서 답변하고 '음성 인식 중'으로 글자가 채워지는지, 아무 말도 안 하면 6초 뒤 무음 안내가 나오는지 봅니다." },
      { id: "q-9", text: "'세션 저장' 후 'JSON 보기'로 SessionRecord(심사위원·전사·qa)가 맞는지 확인합니다." },
    ],
    limitations: [
      "Claude 경로는 실호출로 검증하지 못했습니다. 질문은 gpt-5.5 / gpt-5.4-mini와 Gemini 폴백으로 만들었습니다.",
      "Gemini 폴백 질문 품질은 블라인드 분류(93%)로 다시 재지 않았습니다(눈으로는 유지됨).",
      "같은 입력이면 질문이 거의 같게 나옵니다. '다시 생성'은 이전 질문을 피하도록 각도를 바꿉니다.",
      "주장 추출이 숫자·키워드 규칙 기반이라 정성 위주 발표에서는 약할 수 있습니다.",
      "30분 발표 마이크 녹음은 시험하지 않았습니다(Live 세션 10~15분마다 재연결).",
    ],
    decisions: [
      "질문 생성 모델: Claude Sonnet/Opus 5.5 vs gpt-5.5. Claude 복구(12/1) 후 같은 기준(근거율·블라인드 분류)으로 비교가 필요합니다.",
      "질문 시작 시점: 발표 종료 순간 생성 + 첫 질문 TTS 미리 받기(체감 지연 약 0초)를 제안합니다.",
      "꼬리질문 횟수·시간 규칙(현재 남은 시간 45초 미만이면 꼬리질문 없이 다음 질문).",
    ],
  },
  {
    key: "report",
    title: "리포트 생성",
    requirement: "발표 중 STT 분석, 심사 질문과 답변 타당성, 발표·제안 자료 품질로 리포트 생성",
    href: "/report",
    links: [
      { label: "픽스처 샘플 결과", href: "/report?session=sample%3Asession-bad&view=result" },
      { label: "제공자 상태", href: "/api/report/health" },
    ],
    readme: "pocs/report/README.md",
    summary:
      "SessionRecord 하나로 발표 분석(STT), 질의응답 타당성, 자료 품질, 종합(총점·영역별 점수·잘한 점·개선점) 리포트를 만듭니다. 말 속도, 군말, 문장 길이, 침묵 같은 결정적 지표는 코드로 계산하고, 판단만 고정 루브릭과 zod 스키마로 LLM에 맡깁니다. 섹션을 병렬로 돌려(질문 4개 기준 LLM 9회) 진행 상황을 섹션별로 보여 줍니다. 판별 실험에서 BAD 세션 37점, GOOD 세션 78점으로 갈렸고, 덱↔제안서 수치 불일치 4건을 쪽 번호와 함께 짚습니다.",
    verdict: { label: "리뷰 통과 (3차)", tone: "pass" },
    trail: "리뷰 1차 fail(장애 시 100점 표시) → 9건 수정 → 2차 fail(모바일 넘침) → 6건 수정 → 3차 PASS(minor 5) · UI 70/70",
    remaining: [
      "리뷰 3차 minor 5건: 분당 막대 축척, 영어 enum 노출, 상황 부제 잘림 등.",
      "지금 새 리포트 생성은 Gemini 무료 등급(모델별 하루 20회)에만 기대고 있어 경량 모델로 채점되거나 실패할 수 있습니다. 저장된 리포트는 정상으로 볼 수 있습니다.",
    ],
    steps: [
      { id: "r-1", text: "세션 목록에 픽스처, 심사 질문 PoC 세션, BAD/GOOD 테스트 세션이 보이는지 확인합니다.", href: "/report" },
      { id: "r-2", text: "report-test-bad와 good의 저장된 리포트를 엽니다. 37점 대 78점, 영역별 점수, 잘한 점 / 다음 연습에서는이 납득되는지, BAD에 억지 칭찬이 없는지 봅니다." },
      { id: "r-3", text: "픽스처 샘플에서 '상세 피드백 보기'를 눌러 질문 2(118원 vs 142원)가 회피로 나오는지, 모순 칩(발표자료 p.6, 제안자료 p.34)이 PDF의 그 쪽을 여는지 봅니다." },
      { id: "r-4", text: "질문별 '이렇게 답해 보세요'를 소리 내어 읽어 30초 안에 말할 수 있는지, 자료에 없는 사실을 지어내지 않았는지 봅니다." },
      { id: "r-5", text: "발표 분석 탭에서 말 속도(음절/분), 군말 횟수와 예문 하이라이트, 슬라이드 커버리지 판단이 실제 전사와 맞는지 봅니다." },
      { id: "r-6", text: "자료 품질 탭에서 덱↔제안서 불일치 4건(원가, 이익률, SOM, 점유율)과 쪽 번호, 이슈별 '고치는 법'이 실행 가능한지 봅니다." },
      { id: "r-7", text: "'SessionRecord JSON 붙여넣기'에 sample-session.json을 고쳐 넣고(예: 답변을 '모르겠습니다'로) 점수와 피드백에 반영되는지 봅니다." },
      { id: "r-8", text: "점수 가중치(발표력 25, 논리성 25, 대응력 30, 자료 20)와 전달 지표 기준(240~340음절/분, 군말 분당 2회)이 제품 의도와 맞는지 판단합니다." },
    ],
    limitations: [
      "Claude 경로는 실호출로 검증하지 못했습니다. 저장된 리포트는 gpt-5.5(5건)와 Gemini(1건) 판정입니다.",
      "경량(lite) 모델 판정은 경고만 하고 점수를 보정하지 않습니다(같은 답변을 gpt-5.5는 62점, lite는 86점으로 채점한 사례).",
      "LLM 판정은 실행마다 총점 ±1~3점, 질문 점수 ±5점 정도 변합니다.",
      "문장 단위 타임스탬프만 있어 침묵·속도는 근사치입니다. 억양·목소리 크기와 자료의 시각 디자인은 평가하지 않습니다.",
    ],
    decisions: [
      "점수 가중치(25/25/30/20)와 전달 지표 기준을 확정해 주세요.",
      "발표자가 덱과 제안서 중 한쪽 수치를 말했을 때 감점할지(현재: 한쪽과 일치하면 감점 없음).",
      "채점 모델: Claude Opus 5.5 vs gpt-5.5. 경량 모델로만 채점 가능할 때 리포트를 보여 줄지 막을지.",
    ],
  },
  {
    key: "fixtures",
    title: "테스트 픽스처 (공용)",
    requirement: "다른 PoC가 함께 쓰는 실전형 테스트 데이터",
    href: "/fixtures",
    links: [
      { label: "발표자료 PDF", href: "/fixtures/presentation.pdf" },
      { label: "제안서 PDF", href: "/fixtures/proposal.pdf" },
      { label: "샘플 세션 JSON", href: "/fixtures/sample-session.json" },
    ],
    readme: "pocs/fixtures/README.md",
    summary:
      "'친환경 패키징 사업 제안' 시나리오((주)리웨이브, 해조류 생분해 완충재 웨이브셀, Pre-A 20억 원)로 발표자료(12장 덱), 제안서(A4 58쪽), 54문장 발표 대본, 한국어 음성(57초 발표·17초 답변), SessionRecord 샘플(전사 46문장, 심사위원 3명, 회피성 답변 1개를 포함한 QA 4개)을 만들었습니다. 덱과 제안서 사이에 의도된 약점 4건(원가 118 vs 142원, SOM 340억 vs 210억, 근거 없는 12배 성장, 단일 공급처)을 넣어 question·report의 탐지 능력을 시험합니다.",
    verdict: { label: "리뷰 통과 (1차) · 지적 5건 수정", tone: "pass" },
    trail: "리뷰 1차 PASS(minor 6) → 메타 문구·2공장 시점·대본 링크·덱 줄바꿈·목차 쪽 번호 수정",
    remaining: ["음성은 Gemini 무료 TTS 한도 소진으로 OpenAI gpt-4o-mini-tts로 만들었습니다(요구사항은 Gemini)."],
    steps: [
      { id: "fx-1", text: "발표자료 12장이 실제 피치덱처럼 보이는지, 차트(TAM/SAM/SOM, 월 출고, 매출·영업이익)가 읽히는지 확인합니다.", href: "/fixtures/presentation.pdf" },
      { id: "fx-2", text: "제안서 58쪽을 훑어보고 표가 깨지지 않는지, 원가 장(34쪽)의 142원과 시장 장의 SOM 210억이 덱의 118원·340억과 다른지 확인합니다.", href: "/fixtures/proposal.pdf" },
      { id: "fx-3", text: "speech-ko.wav와 answer-ko.wav를 재생해 발음, 속도, 숫자 읽기가 자연스러운지 들어 봅니다.", href: "/fixtures" },
      { id: "fx-4", text: "샘플 세션의 박준호(빡셈) 원가 질문에 대한 답변이 회피성 약한 답변으로 느껴지는지 확인합니다." },
    ],
    limitations: [
      "제안서 본문은 LLM(gpt-5.4-mini)으로 만들어 팩트 시트에 없는 세부 수치가 장끼리 완전히 맞지 않을 수 있습니다.",
      "덱 폰트는 Pretendard CDN에 의존합니다.",
    ],
    decisions: ["실제 앱 QA용으로 다른 업종 시나리오(예: 공공 제안, 사내 발표)도 필요한지 정해 주세요."],
  },
];

/** 여러 PoC에 걸친 결정 사항 (에이전트들이 공통으로 올린 것) */
export const GLOBAL_DECISIONS: { title: string; detail: string }[] = [
  {
    title: "LLM 제공자 결제 (HIL 전 필수)",
    detail:
      "지금 Claude 키는 2026-12-01까지 사용 한도, OpenAI는 크레딧 0, Gemini는 무료 등급(모델별 하루 10~25회)입니다. 이 상태에서는 위키 새 인제스트, 심사위원 얼굴 생성, 질문·꼬리질문 생성, 리포트 채점이 실패하거나 경량 모델로 떨어집니다. OpenAI 크레딧 충전 또는 Gemini 유료 등급 전환이 필요합니다. 충전하면 코드 수정 없이 1분 안에 원래 경로로 돌아옵니다.",
  },
  {
    title: "기본 LLM 모델",
    detail:
      "wiki·question·report는 Claude 우선(Opus/Sonnet/Haiku 5.5) → OpenAI(gpt-5.5, gpt-5.4-mini) → Gemini 순으로 폴백합니다. 실제 검증은 OpenAI와 Gemini로만 했습니다. Claude 복구 후 같은 테스트(근거율, 블라인드 성향 분류, BAD/GOOD 판별)로 비교해 기본 모델을 정해야 합니다.",
  },
  {
    title: "STT 방식: Live vs 구간 전사",
    detail:
      "Live(gemini-3.5-transcribe-live): 문장 확정 1.4~1.7초, 중간 글자 표시, 단 SDK experimental. 구간 전사(VAD + gemini-3.5-transcribe): 2.5~3.0초, 무료 하루 25회. 현재 Live 기본 + 자동 폴백입니다.",
  },
  {
    title: "TTS 제공자",
    detail:
      "요구사항은 Gemini TTS입니다. 무료 등급은 모델별 하루 10회라 폴백 모델 4개를 돌려 씁니다. question은 Gemini가 막히면 OpenAI TTS로 폴백합니다. 유료 Gemini로 갈지, OpenAI TTS를 공식 폴백으로 둘지 정해 주세요.",
  },
  {
    title: "세션당 비용과 대기 시간",
    detail:
      "참고 실측: 위키 인제스트 58쪽 125초(입력 21만·출력 10만 토큰), 심사위원 얼굴 약 10초/명, 질문 생성 6~11초, 리포트 1~2분(LLM 9회). 업로드 직후 위키·얼굴을 백그라운드로 미리 만들고, 발표 종료 순간 질문 생성, 질의응답 중 발표 분석을 미리 시작하는 파이프라인을 제안합니다.",
  },
  {
    title: "저장소·인증",
    detail:
      "모든 PoC가 단일 Node 프로세스와 .data/ 파일시스템을 씁니다. 실제 앱에서는 DB·오브젝트 스토리지와 사용자 인증, 작업 큐(인제스트·이미지 생성·리포트)가 필요합니다.",
  },
  {
    title: "실기기 검증",
    detail:
      "모든 검증은 헤드리스 Chrome(가짜 카메라·마이크, 합성 터치)으로 했습니다. iPhone Safari / Android Chrome에서 카메라·마이크 권한, 스와이프·핀치, TTS 재생 + STT 동시 사용(에코)을 사람이 확인해야 합니다.",
  },
];
