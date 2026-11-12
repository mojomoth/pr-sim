// Live check of the setup fixes on http://localhost:3000 with /api/wiki + /api/judges stubbed (request interception).
// Scenario A: wiki done degraded=true + all 3 faces fail with providers_unavailable → one notice, real names, degraded note,
//             reload keeps degraded note + names, /present shows the same names.
// Scenario B: one face fails (unsupported) → per-row error stays, no aggregated notice.
import { launch, shot } from "../../../../../pocs/scripts/browser.mjs";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = new URL(".", import.meta.url).pathname;
const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wikiDone() {
  const wiki = [{ slug: "overview", title: "개요", type: "overview", summary: "샘플 개요", sources: [1], markdown: "# 개요\n친환경 완충재 (p.1)" }];
  return (
    JSON.stringify({ type: "progress", phase: "extracting", chunksDone: 1, chunksTotal: 1, roundsDone: 0, roundsTotal: 1, msg: "" }) +
    "\n" +
    JSON.stringify({ type: "done", wiki, keyNumbers: [], usage: { "gemini:gemini-3.8-flash-lite": { calls: 3, inputTokens: 1, outputTokens: 1, ms: 1 } }, ms: 1200, degraded: true }) +
    "\n"
  );
}

async function run(label, judgeLines, { mobile = true } = {}) {
  const { browser, page, logs } = await launch({ mobile });
  const calls = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.pathname === "/api/wiki") {
      calls.push("wiki");
      return req.respond({ status: 200, contentType: "application/x-ndjson", body: wikiDone() });
    }
    if (u.pathname === "/api/judges") {
      const body = JSON.parse(req.postData() ?? "{}");
      calls.push(`judges:${body.temperaments?.length}`);
      return req.respond({ status: 200, contentType: "application/x-ndjson", body: judgeLines(body.temperaments.length) });
    }
    if (u.pathname.startsWith("/api/") && u.pathname !== "/api/stt/token") {
      calls.push(`blocked:${u.pathname}`);
      return req.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "providers_unavailable", message: "stub", fallback: "browser" } }) });
    }
    req.continue();
  });
  // fresh draft
  await page.goto(`${BASE}/setup`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => location.search.includes("s="), { timeout: 15000 });
  await page.evaluate(async () => {
    // start from an empty draft: remove the IndexedDB records of earlier runs in this profile (fresh profile anyway)
  });
  await page.waitForFunction(() => document.querySelectorAll("ul[aria-label='심사위원 목록'] li").length === 3 && !document.body.innerText.includes("만드는 중…"), { timeout: 20000 });
  await sleep(1000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("샘플 자료로 해보기"))?.click());
  try {
    await page.waitForFunction(() => document.body.innerText.includes("자료 분석을 마쳤어요"), { timeout: 30000 });
  } catch (e) {
    await shot(page, `${OUT}${label}-debug.png`, { fullPage: true });
    console.log(calls, logs.slice(-20), (await page.evaluate(() => document.body.innerText)).slice(0, 1500));
    throw e;
  }
  await sleep(400);
  return { browser, page, logs, calls };
}

// ── A: all faces fail the same way ──
{
  const errAll = (n) =>
    Array.from({ length: n }, (_, slot) => JSON.stringify({ type: "error", slot, code: "providers_unavailable", message: "AI 모델을 지금 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요." })).join("\n") +
    "\n" +
    JSON.stringify({ type: "done", ms: 5 }) +
    "\n";
  const { browser, page, logs, calls } = await run("A", errAll);
  const text = await page.evaluate(() => document.body.innerText);
  const generic = (text.match(/AI 모델을 지금 쓸 수 없어요/g) ?? []).length;
  const outage = await page.$$eval("[data-testid=face-outage]", (els) => els.map((e) => e.textContent));
  const degraded = await page.$eval("[data-testid=wiki-degraded]", (e) => e.textContent).catch(() => null);
  const names = await page.$$eval("ul[aria-label='심사위원 목록'] li p.truncate.font-bold", (els) => els.map((e) => e.textContent));
  const initials = await page.$$eval("ul[aria-label='심사위원 목록'] li [role=img]", (els) => els.map((e) => e.textContent?.trim()));
  await page.$eval("[data-testid=wiki-degraded]", (e) => e.scrollIntoView({ block: "start" }));
  await sleep(300);
  await shot(page, `${OUT}A-setup-outage-degraded.png`);
  log("A1 degraded note shown on the doc row", !!degraded && degraded.includes("경량 대체 모델") && degraded.includes("gemini-3.8-flash-lite"), { degraded });
  log("A2 one aggregated face notice, no per-judge generic message", outage.length === 1 && generic === 0 && outage[0].includes("이미지 서비스"), { outage, generic });
  log("A3 faceless judges show real names (not 새 위원)", names.length === 3 && names.every((n) => n && n !== "새 위원" && n !== "새"), { names, initials });
  const bottomDup = text.includes("얼굴 사진이 없는 심사위원은 이름 첫 글자로 표시돼요.");
  log("A4 bottom faceless hint not duplicated while notice shown", !bottomDup, { bottomDup });

  // persisted: reload keeps degraded note and names
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("자료 분석을 마쳤어요"), { timeout: 15000 });
  const degraded2 = await page.$eval("[data-testid=wiki-degraded]", (e) => e.textContent).catch(() => null);
  const names2 = await page.$$eval("ul[aria-label='심사위원 목록'] li p.truncate.font-bold", (els) => els.map((e) => e.textContent));
  const stored = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open("pr-sim");
        r.onsuccess = () => {
          const tx = r.result.transaction("sessions", "readonly");
          const all = tx.objectStore("sessions").getAll();
          all.onsuccess = () => res(all.result.map((s) => ({ status: s.status, doc: s.docs.presentation && { wikiDegraded: s.docs.presentation.wikiDegraded, wikiModel: s.docs.presentation.wikiModel }, judges: s.judges.map((j) => j.name) })));
        };
        r.onerror = () => res(null);
      }),
  );
  await shot(page, `${OUT}A-setup-after-reload.png`, { fullPage: true });
  log("A5 reload keeps degraded note + names (StoredDoc.wikiDegraded persisted)", !!degraded2 && JSON.stringify(names2) === JSON.stringify(names), { names2, stored });

  // /present shows the same names
  await page.$eval("textarea", (el) => el.value || null);
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].find((b) => b.textContent?.includes("발표 시작하기"))?.disabled, { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("발표 시작하기"))?.click());
  await page.waitForFunction(() => location.pathname === "/present", { timeout: 15000 });
  await sleep(2500);
  const presentText = await page.evaluate(() => document.body.innerText);
  await shot(page, `${OUT}A-present-names.png`);
  log("A6 /present shows the same names as setup", names.every((n) => presentText.includes(n)), { names, presentSnippet: presentText.slice(0, 300) });
  writeFileSync(`${OUT}A-logs.txt`, [...calls, ...logs].join("\n"));
  await browser.close();
}

// ── B: only one face fails (policy) → per-row error, no aggregate ──
{
  const png1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const mixed = (n) => {
    const lines = [];
    const people = [
      { name: "도윤", fullName: "정도윤", gender: "male", age: 41 },
      { name: "서연", fullName: "한서연", gender: "female", age: 52 },
    ];
    for (let slot = 0; slot < n; slot++) {
      if (slot === n - 1) lines.push(JSON.stringify({ type: "error", slot, code: "unsupported", message: "이미지 생성이 정책상 거절됐어요. 다시 시도해 주세요." }));
      else {
        const p = people[slot % 2];
        lines.push(JSON.stringify({ type: "judge", slot, model: "stub", judge: { id: `j_stub${slot}`, ...p, temperament: "friendly", voiceHint: "", image: { mime: "image/png", base64: png1.split(",")[1] } } }));
      }
    }
    return lines.join("\n") + "\n" + JSON.stringify({ type: "done", ms: 5 }) + "\n";
  };
  const { browser, page, logs, calls } = await run("B", mixed);
  const outage = await page.$$("[data-testid=face-outage]");
  const text = await page.evaluate(() => document.body.innerText);
  const names = await page.$$eval("ul[aria-label='심사위원 목록'] li p.truncate.font-bold", (els) => els.map((e) => e.textContent));
  await page.$eval("ul[aria-label='심사위원 목록']", (e) => e.scrollIntoView({ block: "center" }));
  await sleep(300);
  await shot(page, `${OUT}B-setup-single-failure.png`);
  log("B1 single failure keeps its own row message, no aggregate", outage.length === 0 && text.includes("정책상 거절"), { names });
  log("B2 failed row still shows a real name", names.length === 3 && names.every((n) => n && n !== "새 위원"), { names });
  writeFileSync(`${OUT}B-logs.txt`, [...calls, ...logs].join("\n"));
  await browser.close();
}

writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
