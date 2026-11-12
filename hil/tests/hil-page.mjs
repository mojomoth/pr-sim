// HIL page E2E: render (mobile+desktop), checkbox/verdict/feedback persistence across reload, provider card,
// markdown export, reset, blocked-storage fallback, overflow, console errors. Run from pocs/: node hil/tests/hil-page.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import { writeFileSync } from "node:fs";

const out = [];
const ok = (name, cond, extra = "") => {
  out.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`);
};
const errs = (logs) => logs.filter((l) => /^\[(error|pageerror|requestfailed)\]/.test(l));
const wait = (ms) => new Promise((s) => setTimeout(s, ms));

for (const mobile of [true, false]) {
  const tag = mobile ? "mobile" : "desktop";
  const { browser, page, logs } = await launch({ mobile });
  const t0 = Date.now();
  const res = await page.goto(`${BASE}/hil`, { waitUntil: "networkidle2", timeout: 60000 });
  ok(`${tag}: HTTP 200`, res.status() === 200, `${Date.now() - t0}ms`);
  await page
    .waitForFunction(() => /곳 중 \d곳 사용 가능/.test(document.body.innerText), { timeout: 40000 })
    .catch(() => {});
  const txt = await page.evaluate(() => document.body.innerText);
  ok(`${tag}: provider card rendered`, /곳 중 \d곳 사용 가능/.test(txt));
  ok(`${tag}: all 8 PoC sections`, (await page.$$('section[id^="poc-"]')).length === 8);
  ok(`${tag}: global decisions`, txt.includes("LLM 제공자 결제"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`${tag}: no horizontal overflow`, overflow <= 0, `overflow=${overflow}`);
  await shot(page, `.verify/hil/${tag}-top.png`);
  await shot(page, `.verify/hil/${tag}-full.png`, { fullPage: true });

  if (mobile) {
    await page.evaluate(() => document.querySelector("#poc-ui").scrollIntoView());
    await page.evaluate(() => {
      const boxes = document.querySelectorAll('#poc-ui input[type="checkbox"]');
      boxes[0].closest("label").click();
      boxes[2].closest("label").click();
    });
    await page.evaluate(() =>
      [...document.querySelectorAll('#poc-ui [role="radio"]')].find((b) => b.textContent === "수정 필요").click(),
    );
    await page.type("#poc-ui textarea", "테스트 피드백: 타이머 리셋 문제 확인");
    await wait(300);
    await shot(page, `.verify/hil/mobile-ui-card.png`);
    const navText = await page.evaluate(
      () => [...document.querySelectorAll("nav a")].find((a) => a.textContent.startsWith("UI 개발"))?.textContent,
    );
    ok("mobile: nav shows 2/10 for UI", navText?.includes("2/10"), navText);
    await page.reload({ waitUntil: "networkidle2" });
    await wait(500);
    const after = await page.evaluate(() => ({
      checked: [...document.querySelectorAll('#poc-ui input[type="checkbox"]')].map((b) => b.checked),
      verdict: [...document.querySelectorAll('#poc-ui [role="radio"]')].find((b) => b.getAttribute("aria-checked") === "true")
        ?.textContent,
      fb: document.querySelector("#poc-ui textarea").value,
      prog: document.body.innerText.match(/체크 \d+ \/ \d+ · 판단 \d+ \/ \d+/)?.[0],
    }));
    ok("mobile: checks persisted after reload", after.checked[0] && !after.checked[1] && after.checked[2], JSON.stringify(after.checked.slice(0, 3)));
    ok("mobile: verdict persisted", after.verdict === "수정 필요");
    ok("mobile: feedback persisted", after.fb.includes("타이머 리셋"));
    ok("mobile: overall progress updated", after.prog?.startsWith("체크 2 /") && after.prog.includes("판단 1 /"), after.prog);

    await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "피드백 복사").click());
    await wait(400);
    const md = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e.message}`);
    ok(
      "mobile: markdown export contains feedback",
      md.includes("## UI 개발") && md.includes("타이머 리셋") && md.includes("수정 필요"),
      md.slice(0, 60).replace(/\n/g, " | "),
    );
    await shot(page, `.verify/hil/mobile-after-copy.png`);

    page.once("dialog", (d) => d.accept());
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "초기화").click());
    await wait(300);
    const cleared = await page.evaluate(
      () =>
        document.querySelector("#poc-ui textarea").value === "" &&
        ![...document.querySelectorAll('#poc-ui input[type="checkbox"]')].some((b) => b.checked),
    );
    ok("mobile: reset clears state", cleared);
  }
  ok(`${tag}: console errors 0`, errs(logs).length === 0, errs(logs).join(" | ").slice(0, 300));
  await browser.close();
}

// Blocked storage: the localStorage accessor throws -> page still renders, works in memory, and warns.
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await page.goto(`${BASE}/hil`, { waitUntil: "networkidle2" });
  await page.evaluate(() => document.querySelector('#poc-slide input[type="checkbox"]').closest("label").click());
  await wait(300);
  const r = await page.evaluate(() => ({
    warn: document.body.innerText.includes("저장이 막혀 있어요"),
    checked: document.querySelector('#poc-slide input[type="checkbox"]').checked,
  }));
  ok("blocked storage: warning shown", r.warn);
  ok("blocked storage: checkbox still works in-memory", r.checked);
  const pe = logs.filter((l) => l.startsWith("[pageerror]"));
  ok("blocked storage: no page errors", pe.length === 0, pe.join(" | "));
  await shot(page, `.verify/hil/mobile-blocked-storage.png`);
  await browser.close();
}

writeFileSync(".verify/hil/hil-page.json", JSON.stringify(out, null, 1));
console.log(`${out.filter((o) => o.pass).length}/${out.length} PASS`);
