// Registry of PoCs shown on the hub (/) and devlog (/devlog).
export const POCS = [
  { key: "fixtures", title: "테스트 픽스처", path: null, desc: "샘플 발표자료·제안자료 PDF, 테스트 음성" },
  { key: "ui", title: "UI 개발", path: "/ui", desc: "DESIGN.md 기반 7개 화면 (랜딩 → 목록)" },
  { key: "stt-tts", title: "STT / TTS", path: "/stt-tts", desc: "Gemini 문장 단위 전사 · 페르소나별 음성 생성" },
  { key: "wiki", title: "Context to Wiki", path: "/wiki", desc: "업로드 PDF → LLM Wiki (Karpathy) 컨텍스트" },
  { key: "judge", title: "심사위원 생성", path: "/judge", desc: "OpenAI 실사 얼굴 이미지 · 성향 3종 입력" },
  { key: "slide", title: "Slide View", path: "/slide", desc: "PDF 좌/우 스와이프 뷰어" },
  { key: "question", title: "심사 질문", path: "/question", desc: "전사·자료 기반 페르소나 질문 생성" },
  { key: "report", title: "리포트 생성", path: "/report", desc: "STT·Q&A·자료 품질 종합 리포트" },
] as const;
export type PocKey = (typeof POCS)[number]["key"];
