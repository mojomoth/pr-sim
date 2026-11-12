// Builds fixtures/sample-session.json (a SessionRecord, see lib/types.ts) from presentation-script.txt.
// Deterministic, no API calls. Run from pocs/:  node fixtures/scripts/gen-session.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "fixtures");
const lines = readFileSync(join(ROOT, "presentation-script.txt"), "utf8").split("\n").map((s) => s.trim()).filter(Boolean);

// Simulate a real run: the presenter skipped a few script lines (time pressure) and STT made a few typical errors.
const SKIP = new Set([3, 9, 16, 28, 31, 43, 46, 47]); // 0-based script line indices not spoken
const STT_ERRORS = [
  ["완충재", "완충제"], // common homophone confusion (applied to a few lines only)
  ["대체재", "대체제"],
];
const ERROR_LINES = new Set([1, 7, 21]);

const CHARS_PER_SEC = 6.4; // ~ natural Korean presentation pace
const GAP = 0.7;
let t = 1.2;
const transcript = [];
lines.forEach((text, i) => {
  if (SKIP.has(i)) return;
  let out = text;
  if (ERROR_LINES.has(i)) for (const [a, b] of STT_ERRORS) out = out.replaceAll(a, b);
  transcript.push({ t: +t.toFixed(1), text: out, phase: "presentation" });
  t += text.replace(/\s/g, "").length / CHARS_PER_SEC + GAP;
});

const judges = [
  { id: "judge-friendly-1", name: "이정민", temperament: "friendly", gender: "female", age: 44 },
  { id: "judge-strict-1", name: "박준호", temperament: "strict", gender: "male", age: 52 },
  { id: "judge-aggressive-1", name: "최태성", temperament: "aggressive", gender: "male", age: 58 },
];
const j = (id) => {
  const { name, temperament } = judges.find((x) => x.id === id);
  return { id, name, temperament };
};

const qa = [
  {
    judge: j("judge-friendly-1"),
    question: "파일럿 고객 재구매율이 83퍼센트로 꽤 높은데요, 고객들이 가장 만족한 부분은 무엇이었나요?",
    answer:
      "네, 감사합니다. 가장 많이 들은 피드백은 언박싱할 때 고객 반응이 좋다는 거였습니다. 신선식품 브랜드 한 곳은 웨이브셀로 바꾼 뒤에 리뷰에서 포장 관련 불만이 40퍼센트 정도 줄었다고 했고요. 그리고 주문하고 5일이면 받을 수 있어서 재고 부담이 적다는 점도 많이 말씀해 주셨습니다.",
    askedAt: 4,
  },
  {
    judge: j("judge-strict-1"),
    question: "발표에서는 세트당 원가가 118원이라고 하셨는데, 제출하신 사업계획서 원가 구조에는 142원으로 되어 있습니다. 어느 쪽이 맞는 숫자입니까?",
    // deliberately weak / evasive answer
    answer:
      "아, 음, 그건 기준이 좀 달라서요. 양산 기준으로 보면 118원이 맞고요, 142원은 아마 초기 수치가 들어간 것 같습니다. 어쨌든 중요한 건 2028년에는 92원까지 내려간다는 거고, 그러니까 방향성은 확실합니다.",
    askedAt: 52,
  },
  {
    judge: j("judge-aggressive-1"),
    question: "원가가 기존 포장재보다 높은데 어떻게 경쟁하나요?",
    answer:
      "네, 지금 원가가 스티로폼보다 높은 건 맞습니다. 다만 저희 원료는 처리비를 받고 수거하는 수산 부산물이라서, 내년 3분기에 2공장이 가동되면 2028년에는 세트당 92원까지 낮출 수 있습니다.",
    askedAt: 98,
  },
  {
    judge: j("judge-strict-1"),
    question: "내년 매출을 32억 원으로 잡으셨는데 올해 예상 2억 7천만 원의 12배입니다. 1공장 생산능력이 월 25만 세트인데, 생산 측면에서 이게 가능한 숫자입니까?",
    // partially convincing: names levers but never checks capacity math
    answer:
      "네, 1공장만으로는 어렵고요, 2공장이 내년 3분기에 가동되면 월 150만 세트까지 가능합니다. 그리고 LOI 3건이 본계약으로 전환되면 그것만으로 연 24억 원 규모라서, 신규 고객까지 더하면 충분히 달성 가능하다고 보고 있습니다.",
    askedAt: 131,
  },
];

const session = {
  id: "fixture-session-rewave-001",
  situation:
    "시드 투자 이후 Pre-A 라운드(20억 원) 투자 유치를 위한 벤처캐피털 투자심사위원회 피칭. 심사위원 3명 앞에서 친환경 패키징 사업(해조류 부산물 기반 생분해 완충재)을 5분 발표하고 3분 질의응답을 진행한다.",
  presentationMinutes: 5,
  qaMinutes: 3,
  judges,
  transcript,
  qa,
  createdAt: "2026-11-12T13:00:00.000Z",
};

writeFileSync(join(ROOT, "sample-session.json"), JSON.stringify(session, null, 2) + "\n");
console.log(`wrote fixtures/sample-session.json: ${transcript.length} sentences, last t=${transcript.at(-1).t}s, ${qa.length} QA items`);
