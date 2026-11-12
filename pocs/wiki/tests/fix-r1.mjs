// Round-1 fix verification (reviewer findings). Run from pocs/: node wiki/tests/fix-r1.mjs
// Screenshots → .verify/wiki/fix-r1/
import { writeFileSync } from "node:fs";
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = ".verify/wiki/fix-r1";
const PROPOSAL = "cb3e5a08f4107921";
const LARGE = "4fca1ca885eef124";
const BROKEN = "56cccdc7e7d37aac"; // failed during extraction (no meta.json)
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};
const http404 = (logs) => logs.filter((l) => /404|Failed to load resource/.test(l));

// ---------------------------------------------------------------- 1) citation chips (desktop)
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/wiki?doc=${PROPOSAL}&tab=wiki&page=${encodeURIComponent("주요-수치")}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const r = await page.evaluate(() => {
    const chips = [...document.querySelectorAll("article button")].map((b) => b.textContent.trim());
    return { pchips: chips.filter((t) => /^p\.\d/.test(t)).length, ranges: chips.filter((t) => /^p\.\d+–\d+/.test(t)).length, more: chips.filter((t) => /^\+\d+쪽$/.test(t)).length };
  });
  check("주요-수치: 가짜 범위 칩(p.A–B) 없음", r.ranges === 0, JSON.stringify(r));
  // 임직원 수 row: chips + "+N" and the sheet lists every cited page
  const row = await page.evaluate(() => {
    const tr = [...document.querySelectorAll("article tr")].find((t) => t.textContent.startsWith("임직원 수"));
    if (!tr) return null;
    const btns = [...tr.querySelectorAll("button")].map((b) => b.textContent.trim());
    return { text: tr.textContent.slice(0, 120), btns };
  });
  check("임직원 수 행이 실제 쪽 번호를 보여 줌", !!row && row.btns.some((b) => /^\+\d+쪽$/.test(b)) && row.btns.includes("p.3"), JSON.stringify(row));
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll("article tr")].find((t) => t.textContent.startsWith("임직원 수"));
    [...tr.querySelectorAll("button")].find((b) => /^\+\d+쪽$/.test(b.textContent.trim())).click();
  });
  await sleep(1200);
  const sheet = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { head: d?.querySelector("p")?.textContent, page: d?.querySelectorAll("p")[1]?.textContent, tabs: [...(d?.querySelectorAll('[role="tab"]') ?? [])].map((b) => b.textContent), text: d?.querySelector("pre")?.textContent };
  });
  const kn = await (await fetch(`${BASE}/api/wiki/docs/${PROPOSAL}`)).json();
  const row14 = kn.keyNumbers.find((k) => k.metric === "임직원 수");
  check("+N 칩 → 시트에 인용된 모든 쪽 목록", JSON.stringify(sheet.tabs) === JSON.stringify(row14.pages.map((p) => `p.${p}`)), `${sheet.head} | ${sheet.page} | tabs ${sheet.tabs.join(" ")} | keynumbers ${row14.pages}`);
  check("열린 쪽 원문에 '14명' 포함", /14\s?명/.test(sheet.text ?? ""), (sheet.text ?? "").replace(/\s+/g, " ").match(/.{0,30}14\s?명.{0,20}/)?.[0]);
  await shot(page, `${OUT}/d-01-cite-group-sheet.png`);
  // step through the whole group with › starting from its first page
  await page.evaluate(() => document.querySelector('[role="dialog"] [role="tab"]').click());
  await sleep(600);
  const visited = [];
  for (let k = 0; k < row14.pages.length + 1; k++) {
    const st = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return { p: d.querySelectorAll("p")[1].textContent.split(" ")[0], next: !d.querySelector('[aria-label="다음 출처 쪽"]').disabled, txt: d.querySelector("pre").textContent };
    });
    visited.push(`${st.p}:${/14\s?명/.test(st.txt) ? "14명✓" : "✗"}`);
    if (!st.next) break;
    await page.click('[aria-label="다음 출처 쪽"]');
    await sleep(500);
  }
  check("› 가 인용된 쪽만 차례로 이동 + 각 쪽에 14명 있음", visited.every((v) => v.endsWith("✓")), visited.join(" "));
  await page.keyboard.press("Escape");

  // 128p: SOM row now flagged
  await page.goto(`${BASE}/wiki?doc=${LARGE}&tab=wiki&page=${encodeURIComponent("주요-수치")}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const som = await page.evaluate(() => [...document.querySelectorAll("article tr")].find((t) => /^SOM\s/.test(t.textContent) || t.cells?.[0]?.textContent === "SOM")?.textContent);
  check("128p 주요-수치: SOM 행에 ⚠ + p.63 340억", /⚠/.test(som ?? "") && /p\.63에는 340억/.test(som ?? ""), som);
  await page.evaluate(() => [...document.querySelectorAll("article tr")].find((t) => t.cells?.[0]?.textContent === "SOM")?.scrollIntoView({ block: "center" }));
  await shot(page, `${OUT}/d-02-large-som-conflict.png`);
  const r2 = await page.evaluate(() => [...document.querySelectorAll("article button")].filter((b) => /^p\.\d+–\d+/.test(b.textContent.trim())).length);
  check("128p 주요-수치: 범위 칩 없음", r2 === 0, String(r2));

  // ------------------------------------------------------------ 2) doc switch → no 404 for the new doc
  await page.goto(`${BASE}/wiki?doc=${PROPOSAL}&tab=wiki&page=overview`, { waitUntil: "networkidle0" });
  await sleep(1200);
  logs.length = 0;
  await page.evaluate(() => [...document.querySelectorAll("li button")].find((b) => b.textContent.includes("리뷰 (테스트)"))?.click());
  await sleep(2000);
  const errBox = await page.evaluate(() => document.querySelector("main, body").innerText.match(/위키를 만들지 못했습니다:[^\n]*/)?.[0]);
  check("실패 문서 선택 시 404 요청 없음", http404(logs).length === 0, http404(logs).join(" | ") || "logs clean");
  check("실패 문서 오류 메시지 표시", !!errBox, errBox);
  await page.evaluate(() => [...document.querySelectorAll("li button")].find((b) => b.textContent.includes("large-128p"))?.click());
  await sleep(2000);
  check("ready 문서 간 전환 시 404 없음", http404(logs).length === 0, http404(logs).join(" | ") || "logs clean");

  // ------------------------------------------------------------ 3) failed doc survives reload
  await page.goto(`${BASE}/wiki?doc=${BROKEN}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const after = await page.evaluate(() => ({ url: location.search, current: document.querySelector('li button[aria-current="true"]')?.innerText, body: document.body.innerText.match(/위키를 만들지 못했습니다:[^\n]*/)?.[0], retry: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "다시 시도") }));
  check("새로고침 후에도 실패 문서가 목록·URL에 남음", after.url.includes(BROKEN) && /리뷰 \(테스트\)/.test(after.current ?? ""), JSON.stringify(after));
  check("실패 문서에 '다시 시도' 버튼", after.retry);
  check("파일명 괄호 보존", /리뷰 \(테스트\) 30-45\.pdf/.test(after.current ?? ""), after.current?.split("\n")[0]);
  await shot(page, `${OUT}/d-03-failed-doc-after-reload.png`);

  // ------------------------------------------------------------ 4) query result survives tab switch; cleared on doc change
  await page.goto(`${BASE}/wiki?doc=${PROPOSAL}&tab=query`, { waitUntil: "networkidle0" });
  await sleep(1200);
  await page.evaluate(() => {
    const cb = [...document.querySelectorAll('input[type="checkbox"]')][0];
    if (cb?.checked) cb.click();
  });
  await page.type("#wiki-q", "세트당 원가와 매출총이익률은?");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.body.innerText.includes("선택된 페이지"), { timeout: 30000 });
  const chip = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent === "선택된 페이지");
    const b = h.parentElement.querySelector("button");
    const t = b.textContent;
    b.click();
    return t;
  });
  await sleep(1000);
  const onWiki = await page.evaluate(() => new URL(location.href).searchParams.get("tab"));
  await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "질의").click());
  await sleep(500);
  const kept = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent === "선택된 페이지");
    return !!h && h.offsetParent !== null && document.querySelector("#wiki-q").value;
  });
  check("선택된 페이지 칩 → 위키 → 질의 복귀 시 결과 유지", onWiki === "wiki" && !!kept, `chip=${chip} tab=${onWiki} kept=${kept}`);
  await shot(page, `${OUT}/d-04-query-kept.png`);
  await page.evaluate(() => [...document.querySelectorAll("li button")].find((b) => b.textContent.includes("presentation.pdf"))?.click());
  await sleep(2500);
  const cleared = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent === "선택된 페이지" && x.offsetParent !== null);
    return { result: !!h, q: document.querySelector("#wiki-q")?.value ?? null, tab: new URL(location.href).searchParams.get("tab") };
  });
  check("문서 바꾸면 이전 문서 질의 결과 사라짐", !cleared.result && !cleared.q, JSON.stringify(cleared));
  check("데스크톱 콘솔 오류 없음", !logs.some((l) => /^\[(error|pageerror)\]/.test(l)), logs.filter((l) => /^\[(error|pageerror)\]/.test(l)).join(" | ") || "clean");
  await browser.close();
}

// ---------------------------------------------------------------- 5) mobile: tapping a sample/doc scrolls to content
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(`${BASE}/wiki?doc=${LARGE}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const y0 = await page.evaluate(() => scrollY);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("샘플: 제안자료")).click());
  await sleep(2500);
  const s1 = await page.evaluate(() => ({ y: scrollY, tabsTop: Math.round(document.querySelector('[role="tablist"]').getBoundingClientRect().top) }));
  check("모바일: 샘플 탭 → 위키 뷰로 스크롤", s1.y > 600 && s1.tabsTop >= 40 && s1.tabsTop < 200, `before y=${y0} after ${JSON.stringify(s1)}`);
  await shot(page, `${OUT}/m-01-after-sample-tap.png`);
  await page.evaluate(() => scrollTo(0, 0));
  await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll("li button")].find((b) => b.textContent.includes("presentation.pdf")).click());
  await sleep(2500);
  const s2 = await page.evaluate(() => ({ y: scrollY, tabsTop: Math.round(document.querySelector('[role="tablist"]').getBoundingClientRect().top), h: document.querySelector("article h2")?.textContent }));
  check("모바일: 문서 목록 탭 → 위키 뷰로 스크롤", s2.y > 600 && s2.tabsTop < 200, JSON.stringify(s2));
  await shot(page, `${OUT}/m-02-after-doc-tap.png`);
  // mobile citation group sheet
  await page.goto(`${BASE}/wiki?doc=${PROPOSAL}&tab=wiki&page=${encodeURIComponent("주요-수치")}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll("article tr")].find((t) => t.textContent.startsWith("세트당 원가") || t.textContent.startsWith("웨이브셀 세트당 원가"));
    tr.scrollIntoView({ block: "center" });
  });
  await sleep(300);
  await shot(page, `${OUT}/m-03-numbers-table.png`);
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll("article tr")].find((t) => t.textContent.startsWith("웨이브셀 세트당 원가"));
    [...tr.querySelectorAll("button")].find((b) => /^\+\d+쪽$/.test(b.textContent.trim()))?.click();
  });
  await sleep(1200);
  await shot(page, `${OUT}/m-04-cite-group-sheet.png`);
  check("모바일 콘솔 오류 없음", !logs.some((l) => /^\[(error|pageerror)\]/.test(l)), logs.filter((l) => /^\[(error|pageerror)\]/.test(l)).join(" | ") || "clean");
  await browser.close();
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
