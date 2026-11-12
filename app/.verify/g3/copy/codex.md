수정할 만한 문구 16개입니다. 제목·버튼의 짧은 명사형은 허용하고, 상투적인 홍보 문구와 의미가 모호하거나 어색한 표현을 골랐습니다. 파일은 수정하지 않았습니다.

| 파일:줄 | 현재 문구 | 수정안 | 이유 |
|---|---|---|---|
| [src/app/page.tsx:45](/Users/jyl/work/study/pr-sim/app/src/app/page.tsx:45) | AI 심사위원과 함께하는 발표 리허설. | AI 심사위원 앞에서 발표와 질의응답을 연습하세요. | ‘함께하는’보다 실제 활동을 명확히 설명합니다. |
| [src/app/page.tsx:47](/Users/jyl/work/study/pr-sim/app/src/app/page.tsx:47) | 다음 무대의 자신감은 여기서 시작됩니다. | 발표를 마치면 점수와 피드백을 확인할 수 있어요. | 추상적인 자신감·무대 비유를 구체적인 기능으로 바꿉니다. |
| [src/app/page.tsx:61](/Users/jyl/work/study/pr-sim/app/src/app/page.tsx:61) | 상황 설정부터 피드백까지, 한 번에. | 발표 상황을 설정하고, 연습한 뒤 피드백을 받아 보세요. | ‘한 번에’의 모호함을 줄이고 문장을 완성합니다. |
| [src/app/history/HistoryScreen.tsx:94](/Users/jyl/work/study/pr-sim/app/src/app/history/HistoryScreen.tsx:94) | 쌓이는 연습, 달라지는 발표. | 지난 연습 기록을 확인하세요. | 대구형 홍보 문구보다 화면의 용도를 직접 설명합니다. |
| [src/app/history/HistoryScreen.tsx:140](/Users/jyl/work/study/pr-sim/app/src/app/history/HistoryScreen.tsx:140) | 첫 시뮬레이션을 마치면 점수와 피드백이 여기에 쌓여요. | 첫 시뮬레이션을 마치면 여기에서 점수와 피드백을 확인할 수 있어요. | 첫 기록이 생기는 상황에 ‘쌓여요’는 어색합니다. |
| [src/app/result/Summary.tsx:30](/Users/jyl/work/study/pr-sim/app/src/app/result/Summary.tsx:30) | 한 번 더, 더 좋은 발표로. | 이번 발표의 평가 결과를 확인하세요. | 막연한 개선 구호를 결과 화면에 맞는 안내로 바꿉니다. |
| [src/app/qa/QaScreen.tsx:44](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:44) | 심사위원마다 물어볼 지점을 나누고 있어요. | 심사위원별로 질문할 주제를 정하고 있어요. | ‘지점을 나누다’가 무엇을 뜻하는지 불분명합니다. |
| [src/app/qa/QaScreen.tsx:447](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:447) | 답변이 아직 들리지 않았어요. | 아직 인식된 답변이 없어요. | 실제로 확인한 상태가 음성 인식 결과임을 명시합니다. |
| [src/app/setup/SetupScreen.tsx:513](/Users/jyl/work/study/pr-sim/app/src/app/setup/SetupScreen.tsx:513) | 얼굴이 없는 심사위원은 이름 첫 글자로 나와요. | 심사위원 사진이 없으면 이름의 첫 글자를 표시해요. | ‘얼굴이 없다’와 ‘글자로 나온다’의 어색함을 없앱니다. |
| [src/app/setup/SetupScreen.tsx:563](/Users/jyl/work/study/pr-sim/app/src/app/setup/SetupScreen.tsx:563) | 글자가 없는 …쪽 외 …개 쪽은 분석에서 빠져요. | 텍스트를 추출하지 못한 페이지는 분석에서 제외돼요. 해당 페이지: {페이지 목록} 외 {나머지 페이지 수}쪽 | ‘개 쪽’의 단위 중복을 없애고 제외 사유를 정확히 설명합니다. |
| [src/features/slide/SlideViewer.tsx:240](/Users/jyl/work/study/pr-sim/app/src/features/slide/SlideViewer.tsx:240) | 페이지를 그리지 못했어요 | 페이지를 표시하지 못했어요 | 내부 렌더링 동작을 사용자에게 익숙한 말로 바꿉니다. |
| [src/app/result/Feedback.tsx:25](/Users/jyl/work/study/pr-sim/app/src/app/result/Feedback.tsx:25) | 질문에 정면으로 답해 보세요. | 질문에서 묻는 내용에 직접 답해 보세요. | 대결을 연상시키는 비유보다 필요한 행동을 명확히 전달합니다. |
| [src/app/result/Feedback.tsx:221](/Users/jyl/work/study/pr-sim/app/src/app/result/Feedback.tsx:221) | 좋은 답변에 필요했던 것 | 답변에 포함해야 할 내용 | ‘좋은’과 ‘것’ 대신 평가 항목의 의미를 구체적으로 드러냅니다. |
| [src/app/result/cite.tsx:188](/Users/jyl/work/study/pr-sim/app/src/app/result/cite.tsx:188) | 발표 전사 / 질의응답 전사 / 전사 | 발표 음성 인식 기록 / 질의응답 음성 인식 기록 / 음성 인식 기록 | ‘전사’만으로는 사용자가 기능을 이해하기 어렵습니다. |
| [src/server/report/generate.ts:124](/Users/jyl/work/study/pr-sim/app/src/server/report/generate.ts:124) | 발표 내용 분석 · 슬라이드 커버리지 | 발표 내용 분석 · 슬라이드별 설명 여부 확인 | ‘커버리지’가 측정하는 대상을 풀어 씁니다. 결과 생성 화면에 표시되는 문구입니다. |
| [src/server/report/generate.ts:128](/Users/jyl/work/study/pr-sim/app/src/server/report/generate.ts:128) | 덱 ↔ 제안서 수치 대조 | 발표 자료와 제안서의 수치 비교 | 다른 화면의 ‘발표 자료’와 용어를 맞추고 기호의 의미를 명시합니다. |