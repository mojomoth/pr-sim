// Builds fixtures/presentation.pdf (12 slides, 1280x720 px, real text) from HTML/CSS + inline SVG charts.
// Run from pocs/:  node fixtures/scripts/build-deck.mjs
// Source HTML is saved to fixtures/src/deck.html.
import puppeteer from "puppeteer-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CHROME } from "../../scripts/browser.mjs";
import { DECK } from "./facts.mjs";

const ROOT = join(process.cwd(), "fixtures");
const ACC = "#1F7A5C"; // single accent (deep sea green)

const css = `
@page { size: 1280px 720px; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { font-family: "Pretendard", "Apple SD Gothic Neo", sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; word-break: keep-all; overflow-wrap: break-word }
.s { width: 1280px; height: 720px; padding: 64px 80px; position: relative; overflow: hidden; page-break-after: always; background: #fff; display: flex; flex-direction: column }
.s:last-child { page-break-after: auto }
.k { font-size: 18px; font-weight: 700; color: ${ACC}; letter-spacing: .02em; margin-bottom: 14px }
h1 { font-size: 46px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2 }
h2 { font-size: 40px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.25 }
p, li { font-size: 21px; line-height: 1.55; color: #333 }
.muted { color: #6B6B6B }
.foot { position: absolute; left: 80px; right: 80px; bottom: 30px; display: flex; justify-content: space-between; font-size: 14px; color: #8A8A8A }
.row { display: flex; gap: 28px }
.card { background: #F5F5F5; border-radius: 24px; padding: 28px 30px; flex: 1 }
.card.ink { background: #111; color: #fff } .card.ink p, .card.ink .muted { color: #CFCFCF }
.big { font-size: 56px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05 }
.acc { color: ${ACC} }
.lab { font-size: 17px; font-weight: 600; color: #6B6B6B; margin-top: 10px }
table { border-collapse: collapse; width: 100%; font-size: 18px }
th, td { padding: 11px 12px; text-align: left; border-bottom: 1px solid #E2E2E2 }
th { font-size: 15px; color: #6B6B6B; font-weight: 600 }
tr.me td { font-weight: 700; background: #EEF5F2 }
.pill { display: inline-block; padding: 6px 14px; border-radius: 999px; background: #F5F5F5; font-size: 15px; font-weight: 600; margin-right: 8px }
.inv { background: #111; color: #fff } .inv p { color: #CFCFCF } .inv .foot { color: #8A8A8A }
`;

const foot = (n) => `<div class="foot"><span>ReWave · 투자 제안 2026</span><span>${String(n).padStart(2, "0")} / 12</span></div>`;

// --- charts --------------------------------------------------------------
function marketCircles() {
  return `<svg width="460" height="460" viewBox="0 0 460 460">
  <circle cx="230" cy="230" r="220" fill="#ECECEC"/>
  <circle cx="230" cy="300" r="140" fill="#D6D6D6"/>
  <circle cx="230" cy="372" r="62" fill="${ACC}"/>
  <text x="230" y="70" text-anchor="middle" font-size="20" font-weight="700" fill="#111">TAM 4.2조 원</text>
  <text x="230" y="205" text-anchor="middle" font-size="20" font-weight="700" fill="#111">SAM 6,800억 원</text>
  <text x="230" y="378" text-anchor="middle" font-size="19" font-weight="800" fill="#fff">SOM 340억</text>
</svg>`;
}

function barChart({ data, w, h, max, unit, highlightFrom = 99, fmt = (v) => v }) {
  const pad = { l: 10, r: 10, t: 34, b: 40 };
  const bw = (w - pad.l - pad.r) / data.length;
  const ih = h - pad.t - pad.b;
  const bars = data.map((d, i) => {
    const bh = (d.v / max) * ih;
    const x = pad.l + i * bw + bw * 0.18;
    const y = pad.t + ih - bh;
    const fill = i >= highlightFrom ? ACC : "#111";
    return `<rect x="${x}" y="${y}" width="${bw * 0.64}" height="${bh}" rx="6" fill="${fill}"/>
      <text x="${x + bw * 0.32}" y="${y - 10}" text-anchor="middle" font-size="16" font-weight="700" fill="#111">${fmt(d.v)}</text>
      <text x="${x + bw * 0.32}" y="${h - 14}" text-anchor="middle" font-size="15" fill="#6B6B6B">${d.l}</text>`;
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#E2E2E2"/>${bars.join("")}<text x="${w - pad.r}" y="16" text-anchor="end" font-size="14" fill="#8A8A8A">${unit}</text></svg>`;
}

function finChart() {
  const yrs = ["2025", "2026E", "2027E", "2028E", "2029E"];
  const rev = [0.9, 2.7, 32, 96, 210];
  const op = [-7, -11, -9, 6, 31];
  const w = 700, h = 420, l = 56, r = 20, t = 30, b = 46;
  const ymin = -20, ymax = 220;
  const Y = (v) => t + ((ymax - v) / (ymax - ymin)) * (h - t - b);
  const bw = (w - l - r) / yrs.length;
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (const g of [0, 50, 100, 150, 200]) s += `<line x1="${l}" x2="${w - r}" y1="${Y(g)}" y2="${Y(g)}" stroke="${g === 0 ? "#BDBDBD" : "#EEEEEE"}"/><text x="${l - 10}" y="${Y(g) + 5}" text-anchor="end" font-size="13" fill="#8A8A8A">${g}</text>`;
  yrs.forEach((yr, i) => {
    const x = l + i * bw + bw * 0.22;
    s += `<rect x="${x}" y="${Y(rev[i])}" width="${bw * 0.56}" height="${Y(0) - Y(rev[i])}" rx="5" fill="${i === 0 ? "#111" : "#3A3A3A"}"/>`;
    s += `<text x="${x + bw * 0.28}" y="${Y(rev[i]) - 10}" text-anchor="middle" font-size="16" font-weight="700">${rev[i]}</text>`;
    s += `<text x="${x + bw * 0.28}" y="${h - 16}" text-anchor="middle" font-size="15" fill="#6B6B6B">${yr}</text>`;
  });
  const pts = op.map((v, i) => `${l + i * bw + bw * 0.5},${Y(v)}`).join(" ");
  s += `<polyline points="${pts}" fill="none" stroke="${ACC}" stroke-width="3.5"/>`;
  op.forEach((v, i) => {
    const cx = l + i * bw + bw * 0.5;
    s += `<circle cx="${cx}" cy="${Y(v)}" r="6" fill="${ACC}"/><text x="${v > 0 ? cx : cx + 10}" y="${Y(v) + (v < 0 ? 22 : -14)}"${v > 0 ? ' text-anchor="middle"' : ""} font-size="15" font-weight="800" fill="${v > 0 ? "#7FD1AE" : ACC}">${v > 0 ? "+" : ""}${v}</text>`;
  });
  s += `<text x="${w - r}" y="16" text-anchor="end" font-size="14" fill="#8A8A8A">단위: 억 원 · 막대 매출 · 선 영업이익</text></svg>`;
  return s;
}

function fundsBars() {
  const items = [["완도 2공장 설비", 45, "9억"], ["R&D (내수 코팅·웨이브팩)", 25, "5억"], ["영업·마케팅", 20, "4억"], ["운영자금", 10, "2억"]];
  return items.map(([n, p, a], i) => `<div style="margin-bottom:20px">
    <div style="display:flex;justify-content:space-between;font-size:19px;font-weight:600;margin-bottom:8px"><span>${n}</span><span class="tabular">${p}% · ${a}</span></div>
    <div style="height:14px;border-radius:7px;background:#333"><div style="height:14px;border-radius:7px;width:${p * 2}%;background:${i === 0 ? ACC : "#fff"}"></div></div></div>`).join("");
}

function processFlow() {
  const steps = [["01", "부산물 수거", "완도 미역·다시마 가공장"], ["02", "세척·건조", "알긴산 추출 잔사"], ["03", "배합", "잔사 + 옥수수 전분"], ["04", "저온 발포 성형", "특허 출원 공정"], ["05", "검수·출고", "리드타임 5일"]];
  return `<div class="row" style="gap:14px">${steps.map(([n, t, d], i) => `<div class="card" style="padding:22px 20px;${i === 3 ? `background:${ACC};color:#fff` : ""}"><div style="font-size:15px;font-weight:700;opacity:.7">${n}</div><div style="font-size:22px;font-weight:800;margin:8px 0 6px">${t}</div><div style="font-size:15px;${i === 3 ? "color:#E3F1EB" : "color:#6B6B6B"}">${d}</div></div>`).join("")}</div>`;
}

// --- slides --------------------------------------------------------------
const slides = [
  // 1 표지
  `<section class="s inv" style="justify-content:space-between">
    <div class="k" style="color:#7FD1AE">Pre-A 투자 제안 · 2026년 11월</div>
    <div>
      <div style="font-size:30px;font-weight:700;color:#9A9A9A;margin-bottom:18px">ReWave · 리웨이브</div>
      <h1 style="font-size:68px;color:#fff">바다에서 온 완충재,<br/>흙으로 돌아갑니다.</h1>
      <p style="margin-top:26px;font-size:24px">해조류 부산물로 만든 생분해 완충재 <strong style="color:#fff">웨이브셀(WaveCell)</strong></p>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:18px;color:#9A9A9A"><span>대표 김서연</span><span>주식회사 리웨이브 · 서울 성수 / 전남 완도</span></div>
  </section>`,
  // 2 문제
  `<section class="s"><div class="k">문제</div><h2>택배 상자 속 완충재는<br/>한 번 쓰고 그대로 버려집니다.</h2>
    <div class="row" style="margin-top:44px">
      <div class="card"><div class="big">51억 개</div><div class="lab">국내 연간 택배 물량 (2024)</div></div>
      <div class="card"><div class="big">31만 톤</div><div class="lab">연간 완충재 폐기물 추정</div></div>
      <div class="card ink"><div class="big acc" style="color:#7FD1AE">≈0%</div><div class="lab" style="color:#CFCFCF">오염된 EPS·에어캡 재활용률</div></div>
    </div>
    <p style="margin-top:34px">과대포장 규제(포장공간비율 50% 이하, 포장 1회) 계도기간 종료 — 브랜드는 <strong>지금 당장</strong> 대체재가 필요하지만, 기존 친환경 대안은 비싸거나 부피가 크거나 산업용 퇴비화 시설이 필요합니다.</p>${foot(2)}</section>`,
  // 3 해결책
  `<section class="s"><div class="k">해결책</div><h2>웨이브셀: 수산 부산물로 만든<br/>EPS 대체 완충재</h2>
    <div class="row" style="margin-top:44px">
      <div class="card"><div class="big acc">90일</div><div class="lab">일반 토양에서 90% 이상 생분해</div><p style="margin-top:14px;font-size:18px">가정 퇴비화 가능, 해양 유입 시에도 분해</p></div>
      <div class="card"><div class="big">92%</div><div class="lab">EPS 대비 낙하충격 흡수율</div><p style="margin-top:14px;font-size:18px">중형 택배 박스 기준 동등 수준 보호</p></div>
      <div class="card"><div class="big">5일</div><div class="lab">국내 생산 리드타임</div><p style="margin-top:14px;font-size:18px">수입 균사체 완충재는 6주</p></div>
    </div>
    <p style="margin-top:30px">원료는 미역·다시마 가공 후 버려지던 <strong>알긴산 추출 잔사</strong> — 처리비를 받고 수거하는 원료라 원가 구조가 다릅니다.</p>${foot(3)}</section>`,
  // 4 제품
  `<section class="s"><div class="k">제품</div><h2>버려지던 잔사가 5단계를 거쳐 완충재가 됩니다</h2>
    <div style="margin-top:40px">${processFlow()}</div>
    <div class="row" style="margin-top:36px;align-items:flex-start">
      <table style="flex:1.3"><thead><tr><th>사양</th><th>웨이브셀</th><th>EPS</th></tr></thead><tbody>
        <tr><td>낙하충격 흡수</td><td>EPS 대비 92%</td><td>100%</td></tr>
        <tr><td>무게</td><td>EPS 대비 1.3배</td><td>1.0</td></tr>
        <tr><td>생분해</td><td>토양 90일 · 90%</td><td>불가</td></tr></tbody></table>
      <div class="card" style="flex:1"><div style="font-size:20px;font-weight:800">지식재산권</div><p style="font-size:18px;margin-top:8px">등록 1건 · 출원 2건<br/>(발포 조성물, 저온 성형, 내수 코팅)</p><p style="font-size:16px;margin-top:10px" class="muted">후속: 웨이브팩 — 콜드체인 단열 내장재 (2027 Q4)</p></div>
    </div>${foot(4)}</section>`,
  // 5 시장
  `<section class="s"><div class="k">시장 규모</div>
    <div class="row" style="align-items:center;gap:60px;flex:1">
      <div style="flex:1"><h2>4.2조 원 완충재 시장에서<br/>2029년 340억 원</h2>
        <table style="margin-top:34px"><tbody>
          <tr><td><strong>TAM</strong></td><td>국내 보호 포장재(완충재) 시장</td><td style="text-align:right"><strong>4.2조 원</strong></td></tr>
          <tr><td><strong>SAM</strong></td><td>이커머스·신선식품·화장품 친환경 수요</td><td style="text-align:right"><strong>6,800억 원</strong></td></tr>
          <tr class="me"><td><strong>SOM</strong></td><td>2029년 SAM의 5% 점유</td><td style="text-align:right"><strong>${DECK.som.split(" (")[0]}</strong></td></tr></tbody></table>
      </div>
      <div>${marketCircles()}</div>
    </div>${foot(5)}</section>`,
  // 6 비즈니스 모델
  `<section class="s"><div class="k">비즈니스 모델</div><h2>B2B 정기공급으로 반복 매출을 만듭니다</h2>
    <div class="row" style="margin-top:40px">
      <div class="card"><div style="font-size:22px;font-weight:800">직접 판매</div><p style="font-size:18px;margin-top:8px">D2C 브랜드·신선식품 몰<br/>세트당 165원</p></div>
      <div class="card"><div style="font-size:22px;font-weight:800">3PL 번들</div><p style="font-size:18px;margin-top:8px">물류대행사 포장 라인에 기본 탑재</p></div>
      <div class="card"><div style="font-size:22px;font-weight:800">정기공급 구독</div><p style="font-size:18px;margin-top:8px">3개월 약정 · 월 자동 출고<br/>대량(월 50만 세트↑) 148원</p></div>
    </div>
    <div class="card ink" style="margin-top:28px;flex:0;display:flex;gap:60px;align-items:center">
      <div><div class="lab" style="margin:0 0 6px;color:#9A9A9A">판매가 / 세트</div><div class="big" style="font-size:44px">${DECK.price}원</div></div>
      <div><div class="lab" style="margin:0 0 6px;color:#9A9A9A">원가 / 세트 (2026 양산)</div><div class="big" style="font-size:44px">${DECK.unitCost}원</div></div>
      <div><div class="lab" style="margin:0 0 6px;color:#9A9A9A">매출총이익률</div><div class="big" style="font-size:44px;color:#7FD1AE">${DECK.grossMargin}</div></div>
      <div><div class="lab" style="margin:0 0 6px;color:#9A9A9A">2028 목표 원가</div><div class="big" style="font-size:44px">92원</div></div>
    </div>${foot(6)}</section>`,
  // 7 경쟁
  `<section class="s"><div class="k">경쟁 분석</div><h2>싸고, 흙에서 분해되고, 빨리 받습니다</h2>
    <table style="margin-top:34px"><thead><tr><th>대안</th><th>세트당 가격</th><th>완충 성능</th><th>생분해 조건</th><th>부피·물류</th><th>리드타임</th></tr></thead><tbody>
      <tr><td>EPS(스티로폼)</td><td>85원</td><td>우수</td><td>불가</td><td>가벼움</td><td>즉시</td></tr>
      <tr><td>에어캡</td><td>60원</td><td>보통</td><td>불가</td><td>가벼움</td><td>즉시</td></tr>
      <tr><td>종이 허니콤</td><td>120원</td><td>보통</td><td>재활용</td><td>부피 큼</td><td>1주</td></tr>
      <tr><td>PLA 발포 (국내 G사)</td><td>150원</td><td>양호</td><td>산업용 퇴비화</td><td>보통</td><td>2주</td></tr>
      <tr><td>버섯균사체 (해외 E사)</td><td>310원</td><td>양호</td><td>가정 퇴비화</td><td>보통</td><td>6주</td></tr>
      <tr class="me"><td>웨이브셀</td><td>165원</td><td>양호 (EPS 92%)</td><td>일반 토양 90일</td><td>보통</td><td>5일</td></tr></tbody></table>
    <p style="margin-top:22px;font-size:18px" class="muted">진입장벽: 수산 부산물 수거 네트워크 · 저온 성형 특허 · 원료 산지 공장</p>${foot(7)}</section>`,
  // 8 트랙션
  `<section class="s"><div class="k">트랙션</div><h2>9개월 만에 월 출고 3배</h2>
    <div class="row" style="margin-top:26px;align-items:flex-end">
      <div style="flex:1.5">${barChart({ data: [6.0, 7.0, 8.2, 9.5, 11.0, 12.6, 14.3, 16.0, 18.0].map((v, i) => ({ v, l: `${i + 1}월` })), w: 640, h: 380, max: 20, unit: "2026년 월 출고량 · 만 세트", highlightFrom: 8 })}</div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card"><div class="big" style="font-size:44px">12곳</div><div class="lab">파일럿 고객</div></div>
        <div class="card"><div class="big" style="font-size:44px">83%</div><div class="lab">재구매율</div></div>
        <div class="card"><div class="big" style="font-size:44px">158만</div><div class="lab">누적 출고 세트</div></div>
        <div class="card ink"><div class="big" style="font-size:44px;color:#7FD1AE">24억</div><div class="lab" style="color:#CFCFCF">LOI 3건 (연 환산)</div></div>
      </div>
    </div>${foot(8)}</section>`,
  // 9 재무
  `<section class="s"><div class="k">재무 계획</div>
    <div class="row" style="align-items:center;gap:40px;flex:1">
      <div style="flex:1"><h2>2028년 흑자 전환,<br/>2029년 매출 210억 원</h2>
        <ul style="margin-top:28px;padding-left:22px"><li>LOI 3건 본계약 전환</li><li>2027년부터 월 신규 고객 8곳</li><li>2027 Q3 완도 2공장 가동</li><li>원가 118원 → 92원 (2028)</li></ul></div>
      <div>${finChart()}</div>
    </div>${foot(9)}</section>`,
  // 10 팀
  `<section class="s"><div class="k">팀</div><h2>물류 · 소재 · 생산 · 영업을 다 해본 사람들</h2>
    <div class="row" style="margin-top:40px">
      ${[["김서연", "대표", "대형 물류기업 포장혁신팀 8년 · 친환경 포장 전환 프로젝트 리드"], ["박도윤", "CTO", "생명화학공학 박사 · 해조류 바이오소재 7년 · 특허 3건 발명자"], ["이현우", "COO", "제지사 생산관리 12년 · 공장 2곳 셋업"], ["정다은", "영업총괄", "D2C 브랜드 B2B 영업 6년"]].map(([n, r, d]) => `<div class="card"><div style="width:64px;height:64px;border-radius:32px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800">${n[0]}</div><div style="font-size:26px;font-weight:800;margin-top:18px">${n}</div><div style="font-size:17px;font-weight:700" class="acc">${r}</div><p style="font-size:17px;margin-top:10px">${d}</p></div>`).join("")}
    </div>
    <p style="margin-top:26px;font-size:18px" class="muted">임직원 14명 · 자문: 해양바이오 연구소 수석연구원, 패키징 디자인 교수</p>${foot(10)}</section>`,
  // 11 로드맵
  `<section class="s"><div class="k">로드맵</div><h2>2공장으로 원가와 물량을 동시에 잡습니다</h2>
    <div style="position:relative;margin-top:70px">
      <div style="position:absolute;left:0;right:0;top:11px;height:3px;background:#E2E2E2"></div>
      <div class="row" style="gap:18px;position:relative">
        ${[["2026 Q4", "내수 코팅 v2 완료", "고습 강도 저하 해결"], ["2027 Q1", "Pre-A 클로징", "20억 원"], ["2027 Q3", "완도 2공장 가동", "월 150만 세트"], ["2027 Q4", "웨이브팩 출시", "콜드체인 단열재"], ["2028", "일본 수출 파일럿 · 흑자 전환", "원가 92원"]].map(([q, t, d], i) => `<div style="flex:1"><div style="width:25px;height:25px;border-radius:13px;background:${i === 2 ? ACC : "#111"}"></div><div style="font-size:17px;font-weight:700;margin-top:18px" class="${i === 2 ? "acc" : "muted"}">${q}</div><div style="font-size:22px;font-weight:800;margin-top:6px">${t}</div><p style="font-size:17px;margin-top:6px">${d}</p></div>`).join("")}
      </div></div>${foot(11)}</section>`,
  // 12 투자 요청
  `<section class="s inv"><div class="k" style="color:#7FD1AE">투자 요청</div>
    <div class="row" style="flex:1;align-items:center;gap:70px">
      <div style="flex:1"><h1 style="color:#fff;font-size:60px">Pre-A 20억 원</h1>
        <p style="margin-top:18px;font-size:22px">투자 전 기업가치 120억 원 · 지분 약 14.3% · 런웨이 18개월</p>
        <p style="margin-top:46px;font-size:30px;font-weight:800;color:#fff">감사합니다.</p>
        <p style="font-size:18px;margin-top:8px">김서연 · ceo@rewave.example</p></div>
      <div style="flex:1">${fundsBars()}</div>
    </div>${foot(12)}</section>`,
];

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>리웨이브 투자 제안</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"/>
<style>${css}</style></head><body>${slides.join("\n")}</body></html>`;

mkdirSync(join(ROOT, "src"), { recursive: true });
writeFileSync(join(ROOT, "src", "deck.html"), html);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto("file://" + join(ROOT, "src", "deck.html"), { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: join(ROOT, "presentation.pdf"), width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log("wrote fixtures/presentation.pdf (" + slides.length + " slides)");
