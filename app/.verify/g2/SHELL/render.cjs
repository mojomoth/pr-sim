const React = require("react"); const { renderToStaticMarkup } = require("react-dom/server"); const { jsx, jsxs, Fragment } = require("react/jsx-runtime");
const C = (n) => require("./c/" + n + ".js");
const { Button, TextLink, BottomBar } = C("Button"); const { StepHeader, BrandHeader, HeaderPill } = C("Header");
const { Screen, Card, MediaToggle } = C("Layout"); const { ChipGroup, Badge } = C("Chip"); const { MinuteSlider } = C("Slider");
const { Timer } = C("Timer"); const { Bubble } = C("Bubble"); const { JudgeTile, JudgeHero, JudgeRow, JudgeAvatar } = C("JudgeCard");
const { UploadRow } = C("UploadRow"); const { Waveform } = C("Waveform"); const { TotalScore, ScoreTiles } = C("Score"); const { CameraView, PermissionNotice } = C("CameraView");
const face = (n) => `http://localhost:3100/ui/judge-${n}.jpg`;
const J = [{ name: "민서", persona: "친절함", imageUrl: face("minseo") }, { name: "준호", persona: "빡셈", imageUrl: face("junho") }, { name: "도윤", persona: "공격적", imageUrl: face("doyun") }];
const noop = () => {};
const h = React.createElement;
const pages = {
  a: h(React.Fragment, null,
    h(Screen, { bottomPad: 124 },
      h(StepHeader, { title: "발표 중", onBack: noop, right: h(HeaderPill, { onClick: noop, outline: true }, "종료") }),
      h("div", { className: "mt-2" }, h(Timer, { label: "발표 남은 시간", remaining: 222, total: 300 })),
      h("div", { className: "mt-4 flex items-end gap-3" }, h(CameraView, { stream: null, status: "denied", variant: "inset" }), h(Waveform, { bars: 16, level: 0.5, className: "h-8" })),
      h("div", { className: "mt-4" }, h(Bubble, { label: "내 발표", listening: true }, "저희는 재활용 가능한 소재로 포장 폐기물을 줄이고자 합니다.")),
      h("div", { className: "mt-4 grid grid-cols-3 gap-2.5" }, J.map((j, i) => h(JudgeTile, { key: i, judge: j, speaking: i === 1 }))),
      h("div", { className: "mt-4 flex gap-2" }, h(MediaToggle, { kind: "mic", on: true, onToggle: noop }), h(MediaToggle, { kind: "camera", on: false, onToggle: noop })),
      h("div", { className: "mt-4" }, h(PermissionNotice, { kind: "카메라", onRetry: noop })),
      h("div", { className: "mt-4" }, h(JudgeHero, { judge: J[1], speaking: true })),
      h("div", { className: "mt-4 flex flex-col gap-3" }, h(Bubble, { label: "심사위원 질문" }, "기존 포장재 대비 원가가 높다면, 어떤 경쟁력으로 시장을 확보하실 건가요?"), h(Bubble, { variant: "me", label: "내 답변", listening: true }, "초기에는 친환경 가치를 중시하는 기업을 중심으로 진입하겠습니다."))),
    h(BottomBar, null, h(Button, { arrow: true }, "발표 마치기"), h("div", { className: "flex justify-center" }, h(TextLink, { href: "/history" }, "기록으로 돌아가기")))),
  b: h(React.Fragment, null,
    h(Screen, { bottomPad: 72 },
      h(BrandHeader, { backHref: "/", right: h(HeaderPill, { href: "/history" }, "기록") }),
      h("div", { className: "mt-4 flex flex-col gap-6" },
        h(MinuteSlider, { label: "발표 시간", value: 5, min: 1, max: 30, onChange: noop }),
        h(UploadRow, { label: "발표 자료", required: true, onFile: async () => {}, onRemove: noop, onSample: async () => {} }),
        h(UploadRow, { label: "제안 자료", value: { name: "proposal.pdf", pages: 58, size: 2400000 }, onFile: async () => {}, onRemove: noop }),
        h("ul", { className: "flex flex-col gap-2" }, h(JudgeRow, { judge: J[0], onRemove: noop }, h(ChipGroup, { size: "sm", onSurface: true, label: "민서 성향", value: "friendly", onChange: noop, options: [{ value: "friendly", label: "친절함" }, { value: "strict", label: "빡셈" }, { value: "aggressive", label: "공격적" }] })), h(JudgeRow, { judge: { name: "새 심사위원", persona: "빡셈", pending: true }, onRemove: noop })),
        h(ChipGroup, { label: "필터", value: "all", onChange: noop, options: [{ value: "all", label: "전체" }, { value: "done", label: "완료" }, { value: "doing", label: "진행 중" }] }),
        h("div", { className: "flex gap-2" }, h(Badge, null, "완료"), h(Badge, { tone: "muted" }, "진행 중"), h(JudgeAvatar, { judge: J[2], size: 40 })),
        h(TotalScore, { score: 82, verdict: "설득력 있는 발표였어요." }),
        h(ScoreTiles, { items: [{ label: "내용", value: 84 }, { label: "전달", value: 80 }, { label: "답변", value: 81 }] }),
        h(Card, { title: "잘한 점" }, h("p", null, "핵심 수치를 먼저 말했어요.")),
        h(Timer, { label: "질의응답 남은 시간", remaining: 18, total: 180, compact: true }),
        h(Button, { variant: "secondary" }, "다시 시작하기"), h(Button, { disabled: true }, "발표 시작"))),
    h(BottomBar, null, h(Button, { arrow: true }, "발표 시작"))),
};
const fs = require("fs");
for (const [k, el] of Object.entries(pages)) fs.writeFileSync(__dirname + `/gallery-${k}.html`, renderToStaticMarkup(el));
console.log("ok");
