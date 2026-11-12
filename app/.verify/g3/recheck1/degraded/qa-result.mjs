// Recheck (OpenAI credits exhausted): seeded post-presentation session (G2 transcript, wiki, 3 judges) →
// /qa (questions via fallback chain?, TTS) → answer → /result → history. Records what works and how failures are shown.
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/degraded";
const seedB = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/visual/seed.json", "utf8"));
const after = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-B/session-after-present.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = []; const L = (...a) => { const s = a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); log.push(s); };
const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/answer-ko-16k.wav" });
const net = [];
page.on("response", (r) => { if (r.url().includes("/api/")) net.push({ url: new URL(r.url()).pathname, status: r.status(), provider: r.headers()["x-provider"] }); });
const text = () => page.evaluate(() => document.body.innerText);
const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.includes(t) && !x.disabled); b?.click(); return !!b; }, t);
const sid = "s_rc1degraded";
try {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res));
  }, { ...after, id: sid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, seedB.blobs);
  await page.goto(`http://localhost:3000/qa?s=${sid}`, { waitUntil: "networkidle2" });
  const ready = await page.waitForFunction(() => /질문이 준비됐어요|질문을 준비하지 못했어요|다시 시도/.test(document.body.innerText), { timeout: 300000, polling: 1000 }).then(() => text());
  L("qa prep:", ready.match(/[^\n]*(준비|못했|실패|쓸 수 없)[^\n]*/g)?.slice(0, 4));
  await shot(page, `${OUT}/01-qa-prep.png`);
  if (/질문이 준비됐어요/.test(ready)) {
    await click("질의응답 시작");
    const t0 = Date.now(); let answered = 0;
    while (Date.now() - t0 < 100000) {
      const st = await page.evaluate(() => ({ ended: /질의응답 시간이 끝났어요|준비한 질문이 모두 끝났어요/.test(document.body.innerText), can: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("답변 완료") && !b.disabled) }));
      if (st.ended) break;
      if (st.can && answered < 3) { await sleep(12000); await shot(page, `${OUT}/02-qa-answer-${answered + 1}.png`); if (await click("답변 완료")) answered++; }
      await sleep(1000);
    }
    L("answered", answered);
    await shot(page, `${OUT}/03-qa-end.png`);
    L("qa end text:", (await text()).slice(0, 300));
    await click("결과 보기");
    await page.waitForFunction(() => location.pathname === "/result", { timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => !/결과를 정리하고 있어요/.test(document.body.innerText), { timeout: 300000, polling: 2000 }).catch(() => {});
    await sleep(1500);
    await shot(page, `${OUT}/04-result.png`);
    L("result text:", (await text()).slice(0, 400));
    await page.goto("http://localhost:3000/history", { waitUntil: "networkidle2" }); await sleep(1500);
    await shot(page, `${OUT}/05-history.png`);
    L("history lists session:", await page.evaluate((sid) => !!document.querySelector(`a[href*="${sid}"]`) || document.body.innerText.length, sid));
  }
} catch (e) { L("error", String(e)); await shot(page, `${OUT}/99-error.png`).catch(() => {}); }
finally {
  writeFileSync(`${OUT}/net.json`, JSON.stringify(net, null, 2)); writeFileSync(`${OUT}/run.log`, log.join("\n")); writeFileSync(`${OUT}/console.log`, logs.join("\n"));
  await browser.close();
}
