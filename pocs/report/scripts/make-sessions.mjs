// Deterministic BAD / GOOD SessionRecords for the report discrimination test (no API calls).
//   node report/scripts/make-sessions.mjs   → report/samples/session-bad.json, session-good.json
// Both reuse the fixture judges and PDFs (no docIds → the report ingests/reuses fixtures/presentation.pdf + proposal.pdf).
import { readFileSync, writeFileSync } from "node:fs";

const base = JSON.parse(readFileSync("fixtures/sample-session.json", "utf8"));
const script = readFileSync("fixtures/presentation-script.txt", "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const syl = (t) => [...t].filter((c) => /[가-힣0-9]/.test(c)).length;

function timed(sentences, { sps, gap, pauses = {} }) {
  let t = 1.0;
  return sentences.map((text, i) => {
    const s = { t: Math.round(t * 10) / 10, text, phase: "presentation" };
    t += syl(text) / sps + gap + (pauses[i] ?? 0);
    return s;
  });
}

// ── GOOD: full script, numbers reconciled with the proposal, no fillers, ~300 음절/분, 6-minute slot ──
const goodScript = script
  .filter((s) => !/^음, 재무 계획/.test(s))
  .map((s) =>
    s
      .replace(/^음, 먼저 /, "먼저 ")
      .replace(/^어, 그리고 중요한 건/, "그리고 중요한 건")
      .replace(/^이제 트랙션을/, "다음은 트랙션입니다. 트랙션을")
      .replace("부산물, 그러니까 알긴산을", "부산물, 즉 알긴산을"),
  )
  .flatMap((s) => {
    if (s.startsWith("저희는 2029년까지 이 시장의 5퍼센트"))
      return ["저희는 2029년까지 이 중 약 3.1퍼센트, 210억 원을 보수적인 목표로 잡았습니다.", "고객 12곳의 실제 구매 단가와 물량을 기준으로 산정한 숫자입니다."];
    if (s.startsWith("판매가는 세트당 165원이고"))
      return ["판매가는 세트당 165원이고, 현재 실제 원가는 세트당 142원입니다.", "원료 18원, 전분 22원, 에너지 31원, 인건비 38원, 물류 19원, 감가상각 14원으로 구성됩니다."];
    if (s.startsWith("그러니까 매출총이익률이")) return ["그래서 현재 매출총이익률은 약 14퍼센트로 아직 낮습니다."];
    if (s.startsWith("내년 3분기에 완도 2공장이"))
      return ["내년 3분기 완도 2공장이 가동되면 자동화로 인건비와 에너지 비용을 줄여, 2028년에는 원가를 92원까지 낮출 계획입니다."];
    if (s.startsWith("내년에는 32억"))
      return [
        "내년 매출 목표는 32억 원이지만, 1공장 생산능력이 월 25만 세트라 2공장 가동 시점이 가장 큰 변수입니다.",
        "2공장이 늦어지면 15억 원 수준의 보수 시나리오로 운영하고, 2028년 96억 원, 2029년 210억 원을 목표로 합니다.",
      ];
    return [s];
  })
  .map((s) => s.replace("재무 계획입니다.", "재무 계획입니다."));
goodScript.splice(goodScript.findIndex((s) => s.startsWith("작년 매출은")), 0, "재무 계획입니다.");

const good = {
  ...base,
  id: "report-test-good",
  presentationMinutes: 6,
  transcript: timed(goodScript, { sps: 5.4, gap: 0.5 }),
  qa: [
    {
      ...base.qa[0],
      answer:
        "감사합니다. 파일럿 고객 12곳 중 10곳이 재구매해서 83퍼센트입니다. 가장 큰 이유는 언박싱 경험이었고, 신선식품 브랜드 한 곳은 웨이브셀로 바꾼 뒤 포장 관련 리뷰 불만이 약 40퍼센트 줄었습니다. 두 번째는 국내 생산이라 주문 후 5일이면 받는 리드타임이어서, 고객사의 재고 부담이 줄었다는 점입니다.",
    },
    {
      ...base.qa[1],
      answer:
        "정확한 지적입니다. 제안서 원가 구조의 142원이 현재 실제 원가이고, 발표자료의 118원은 양산 효율 개선을 가정한 목표치를 현재 값처럼 적은 저희 실수입니다. 142원 기준으로 판매가 165원 대비 매출총이익률은 약 14퍼센트입니다. 구성은 원료 18원, 전분 22원, 에너지 31원, 인건비 38원, 물류 19원, 감가 14원이고, 2공장 자동화로 인건비와 에너지를 줄여 2028년 92원이 목표입니다. 발표자료는 바로 정정하겠습니다.",
    },
    {
      ...base.qa[2],
      answer:
        "현재 원가 142원으로 스티로폼 85원보다 높은 건 맞습니다. 다만 판매가 165원은 해외 균사체 완충재 310원의 절반 수준이고, 일반 토양에서 90일 내 90퍼센트 이상 분해되는 대안은 저희뿐입니다. 고객사는 과대포장 규제 대응과 리뷰 개선 효과 때문에 이 가격을 지불하고 있고, 재구매율 83퍼센트가 그 근거입니다. 원료는 처리비를 받고 수거하는 부산물이라, 2공장 가동 후 2028년 92원이 되면 스티로폼과의 차이는 7원까지 줄어듭니다.",
    },
    {
      ...base.qa[3],
      answer:
        "솔직히 말씀드리면 1공장 월 25만 세트로는 연 300만 세트, 판매가 165원 기준 약 5억 원이 상한이라 1공장만으로는 불가능합니다. 2공장이 내년 3분기에 가동돼 월 150만 세트가 되더라도 하반기 6개월 물량을 더하면 물리적 상한이 약 20억 원이라, 32억 원은 생산능력상 무리한 목표가 맞습니다. 사업계획의 2027년 목표는 생산능력 기준 18억 원 안팎으로 수정하고, LOI 3건, 연 24억 원의 본계약 전환 일정과 2공장 램프업 계획을 함께 제시하겠습니다.",
    },
  ],
};

// ── BAD: filler-heavy, too fast, short, long pauses, wrong numbers (contradict both docs), evasive answers ──
const badScript = [
  "음, 어, 안녕하세요, 저 저희는 리웨이브고요, 그 웨이브셀이라는 거를 만들고 있습니다.",
  "어, 그러니까 이제 택배 완충재가 약간 문제가 많잖아요, 다들 아시다시피.",
  "음, 그 스티로폼 같은 거 진짜 재활용이 거의 안 되고 막 쓰레기가 엄청 나옵니다.",
  "그래서 저희가 이제 해조류로 완충재를 만들었는데요, 어, 뭐랄까 완전 친환경입니다.",
  "음, 그, 일단 흙에 묻으면 뭐 금방 다 분해가 되고요, 성능도 스티로폼이랑 거의 똑같습니다.",
  "그리고 이제 시장이 진짜 큰데요, 음, 전체가 4조 2천억이고 저희는 그중에 SOM 500억 원을 먹을 수 있다고 봅니다.",
  "어, 그러니까 점유율로 치면 약간 한 7퍼센트 정도인데 이건 뭐 충분히 가능하다고 생각합니다.",
  "음, 비즈니스 모델은 그냥 기업한테 파는 거고요, 이제 구독 같은 것도 하고 막 그렇습니다.",
  "어, 판매가는 165원이고 원가는 세트당 98원이라서, 그러니까 이익률이 한 40퍼센트 나옵니다.",
  "음, 이게 진짜 엄청 좋은 구조라서, 뭐 경쟁사들은 약간 따라오기 힘들 거라고 봅니다.",
  "그 경쟁사는 음, 스티로폼이랑 종이랑 버섯 같은 게 있는데 저희가 제일 좋습니다.",
  "어, 이제 트랙션은요, 고객이 지금 30곳 정도 되고요, 재구매율이 95퍼센트입니다.",
  "음, 누적 출고도 막 300만 세트 정도 되고 LOI도 받았고 그렇습니다.",
  "어, 그 재무는 음, 내년에 50억, 그 다음에 150억, 2029년에는 500억 정도 할 수 있을 것 같습니다.",
  "그러니까 이제 이건 뭐 고객들이 계속 늘어나니까 자연스럽게 되는 거라서요.",
  "음, 공장은 지금 1공장이 있는데 이게 뭐 충분히 다 커버가 됩니다.",
  "어, 팀은 그, 저랑 CTO랑 COO가 있고 다들 진짜 경력이 좋습니다.",
  "음, 그래서 이제 투자를 한 30억 정도 받고 싶고요, 그 기업가치는 뭐 200억 정도로 생각합니다.",
  "어, 투자금은 그냥 공장이랑 마케팅이랑 이런 데 쓸 거고요.",
  "음, 아무튼 저희가 진짜 열심히 하겠습니다, 감사합니다.",
];
const bad = {
  ...base,
  id: "report-test-bad",
  transcript: timed(badScript, { sps: 8.5, gap: 0.1, pauses: { 4: 6.5, 12: 5.2, 15: 4.1 } }),
  qa: [
    { ...base.qa[0], answer: "음, 그 뭐 고객분들이 다 좋아하셔서요. 재구매율이 거의 95퍼센트 정도 되고요, 아무튼 만족도가 진짜 높습니다." },
    { ...base.qa[1], answer: "어, 그건 뭐 회계 쪽에서 정리한 거라 저도 정확히는 잘… 어쨌든 저희 원가는 지금 98원 수준이라서 문제없습니다." },
    { ...base.qa[2], answer: "그건 뭐, 친환경이니까 고객들이 비싸도 삽니다. 요즘 다들 ESG 하잖아요. 가격은 크게 중요하지 않습니다." },
    { ...base.qa[3], answer: "네, 그건 걱정 안 하셔도 됩니다. 1공장으로 충분하고요, 모자라면 외주 돌리면 되니까 100억도 가능합니다." },
  ],
};

writeFileSync("report/samples/session-good.json", JSON.stringify(good, null, 1));
writeFileSync("report/samples/session-bad.json", JSON.stringify(bad, null, 1));
console.log("good", good.transcript.length, "sentences, last t", good.transcript.at(-1).t, "| bad", bad.transcript.length, "sentences, last t", bad.transcript.at(-1).t);
