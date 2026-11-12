// G3 P2: replaced/removed PDFs and regenerated/removed judges must not leave blobs in IndexedDB.
// Run: node .verify/g3/setup-blob-leak/verify.mjs  (app on :3000). /api/wiki is stubbed (no cost);
// /api/judges is the real route (one regenerate).
import { launch, shot } from "../../../../pocs/scripts/browser.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const APP = "http://localhost:3000";
const PUB = join(DIR, "../../../public/samples");
const docIdOf = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
const A = docIdOf(join(PUB, "presentation.pdf"));
const C = docIdOf(join(PUB, "proposal.pdf"));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + JSON.stringify(detail) : ""}`);
};

const { browser, page, logs } = await launch({ mobile: true });
await page.setRequestInterception(true);
page.on("request", (r) => {
  if (r.url().includes("/api/wiki")) return r.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { kind: "unavailable", message: "stubbed in verify" } }) });
  r.continue();
});

const blobKeys = () =>
  page.evaluate(
    () =>
      new Promise((res, rej) => {
        const o = indexedDB.open("pr-sim");
        o.onsuccess = () => {
          const r = o.result.transaction("blobs").objectStore("blobs").getAllKeys();
          r.onsuccess = () => res(r.result.sort());
          r.onerror = () => rej(r.error);
        };
      }),
  );
const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));
const waitKeys = async (pred, ms = 8000) => {
  const end = Date.now() + ms;
  let k;
  while (Date.now() < end) {
    k = await blobKeys();
    if (pred(k)) return k;
    await settle(250);
  }
  return k;
};

await page.goto(APP + "/history", { waitUntil: "networkidle0" });
// Seed: a setup draft with 3 judges (color photos), and a finished session that shares pdf:A.
await page.evaluate(
  async ({ A }) => {
    const color = async (hue) => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d");
      const grad = g.createLinearGradient(0, 0, 256, 256);
      grad.addColorStop(0, `hsl(${hue},80%,55%)`);
      grad.addColorStop(1, `hsl(${(hue + 60) % 360},80%,45%)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      return new Promise((r) => c.toBlob(r, "image/png"));
    };
    const now = new Date().toISOString();
    const judge = (id, name, fullName, temperament, gender, age) => ({ id, name, fullName, temperament, gender, age, voiceHint: "", imageKey: `judge:${id}`, thumbKey: `judge:${id}:thumb` });
    const judges = [judge("j_seed1", "지훈", "김지훈", "friendly", "male", 45), judge("j_seed2", "수진", "이수진", "strict", "female", 38), judge("j_seed3", "현석", "박현석", "aggressive", "male", 52)];
    const draft = { id: "s_seed_draft", status: "setup", setup: { situation: "블롭 정리 검증", presentationMinutes: 5, qaMinutes: 3 }, docs: {}, judges, transcript: [], qa: [], createdAt: now, updatedAt: now };
    const doc = { role: "presentation", docId: A, filename: "shared.pdf", bytes: 1, pageCount: 1, pdfKey: `pdf:${A}`, pageTexts: ["x"], emptyPages: [], wikiState: "error" };
    const other = { id: "s_seed_other", status: "done", setup: draft.setup, docs: { presentation: doc }, judges: [], transcript: [], qa: [], createdAt: now, updatedAt: "2000-01-01T00:00:00.000Z" };
    const blobs = [];
    for (const [i, j] of judges.entries()) {
      const b = await color(i * 110);
      blobs.push([j.imageKey, b], [j.thumbKey, b]);
    }
    await new Promise((res, rej) => {
      const o = indexedDB.open("pr-sim", 1);
      o.onupgradeneeded = () => {
        o.result.createObjectStore("sessions", { keyPath: "id" });
        o.result.createObjectStore("blobs");
      };
      o.onsuccess = () => {
        const tx = o.result.transaction(["sessions", "blobs"], "readwrite");
        tx.objectStore("sessions").put(draft);
        tx.objectStore("sessions").put(other);
        for (const [k, b] of blobs) tx.objectStore("blobs").put(b, k);
        tx.oncomplete = () => {
          o.result.close();
          res();
        };
        tx.onerror = () => rej(tx.error);
      };
    });
  },
  { A },
);

await page.goto(APP + "/setup?s=s_seed_draft", { waitUntil: "networkidle0" });
await page.waitForSelector('[aria-label="현석 심사위원 삭제"]');
await settle();
check("seeded 6 judge blobs", (await blobKeys()).length === 6, await blobKeys());
await shot(page, join(DIR, "01-seeded.png"));

// 1) remove a judge → judge:j_seed3 + thumb deleted
await page.click('[aria-label="현석 심사위원 삭제"]');
let k = await waitKeys((k) => !k.includes("judge:j_seed3"));
check("remove judge deletes judge:<id> and :thumb", !k.includes("judge:j_seed3") && !k.includes("judge:j_seed3:thumb") && k.includes("judge:j_seed1"), k);

// 2) regenerate judge 1 (real /api/judges): change persona, then "이 성향으로 새 심사위원 만들기"
await page.click('[aria-label="지훈 심사위원 성향"] button:nth-of-type(2)');
await settle(500);
const regen = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("이 성향으로 새 심사위원 만들기")));
check("regenerate button shown", await page.evaluate((b) => !!b, regen));
await page.evaluate((b) => b?.click(), regen);
await shot(page, join(DIR, "02-regenerating.png"));
k = await waitKeys((k) => !k.includes("judge:j_seed1") && k.filter((x) => x.startsWith("judge:")).length === 4, 120000);
const fresh = k.filter((x) => x.startsWith("judge:") && !x.includes("j_seed"));
check("regenerate deletes old judge:<id> and :thumb, stores new pair", !k.includes("judge:j_seed1") && !k.includes("judge:j_seed1:thumb") && fresh.length === 2, k);
await settle(1500);
await shot(page, join(DIR, "03-regenerated.png"));

// 3) PDFs. presentation ← sample A (shared with s_seed_other), proposal ← sample C
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("샘플 자료로 해보기"))?.click());
k = await waitKeys((k) => k.includes(`pdf:${A}`), 20000);
await page.waitForFunction(() => document.querySelectorAll('[aria-label="발표 자료 삭제"]').length === 1, { timeout: 20000 });
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("샘플 자료로 해보기"))?.click());
k = await waitKeys((k) => k.includes(`pdf:${C}`), 20000);
await page.waitForFunction(() => document.querySelectorAll('[aria-label="제안 자료 삭제"]').length === 1, { timeout: 20000 });
check("both samples stored", k.includes(`pdf:${A}`) && k.includes(`pdf:${C}`), k);
await settle();
await shot(page, join(DIR, "04-two-pdfs.png"), { fullPage: true });

// 4) replace presentation (A) with the proposal file (C): A kept because s_seed_other still uses it
const inputs = await page.$$('input[type="file"]');
await inputs[0].uploadFile(join(PUB, "proposal.pdf"));
await page.waitForFunction(() => document.body.innerText.includes("샘플_리웨이브_제안서") || document.body.innerText.includes("proposal.pdf"), { timeout: 20000 });
await settle(2000);
k = await blobKeys();
check("replace keeps PDF another session uses (pdf:A in s_seed_other)", k.includes(`pdf:${A}`) && k.includes(`pdf:${C}`), k);

// 5) delete s_seed_other's reference, then make the draft drop A for real: put A back and replace it again
await page.evaluate(
  () =>
    new Promise((res) => {
      const o = indexedDB.open("pr-sim");
      o.onsuccess = () => {
        const tx = o.result.transaction("sessions", "readwrite");
        tx.objectStore("sessions").delete("s_seed_other");
        tx.oncomplete = () => res();
      };
    }),
);
await (await page.$$('input[type="file"]'))[0].uploadFile(join(PUB, "presentation.pdf"));
await waitKeys((k) => k.includes(`pdf:${A}`), 15000);
await page.waitForSelector('[aria-label="발표 자료 교체"]', { timeout: 15000 });
await settle(1500);
await (await page.$$('input[type="file"]'))[0].uploadFile(join(PUB, "proposal.pdf"));
k = await waitKeys((k) => !k.includes(`pdf:${A}`), 15000);
check("replace deletes the old pdf:<docId> when no session uses it", !k.includes(`pdf:${A}`) && k.includes(`pdf:${C}`), k);

// 6) remove presentation (C) — proposal still holds C → kept; then remove proposal → C deleted
await (await page.waitForSelector('[aria-label="발표 자료 삭제"]', { timeout: 15000 })).click();
await settle(2000);
k = await blobKeys();
check("remove keeps PDF the other role of the same draft still uses", k.includes(`pdf:${C}`), k);
await (await page.waitForSelector('[aria-label="제안 자료 삭제"]', { timeout: 15000 })).click();
k = await waitKeys((k) => !k.includes(`pdf:${C}`), 8000);
check("remove deletes pdf:<docId>", !k.some((x) => x.startsWith("pdf:")), k);
await settle();
await shot(page, join(DIR, "05-after-removals.png"), { fullPage: true });

// 7) record and blobs agree: every judge key in the draft exists, nothing extra
const rec = await page.evaluate(
  () =>
    new Promise((res) => {
      const o = indexedDB.open("pr-sim");
      o.onsuccess = () => {
        const r = o.result.transaction("sessions").objectStore("sessions").get("s_seed_draft");
        r.onsuccess = () => res(r.result);
      };
    }),
);
const want = rec.judges.flatMap((j) => [j.imageKey, j.thumbKey]).filter(Boolean).sort();
k = await blobKeys();
check("blobs == keys the draft references (no orphans, nothing missing)", JSON.stringify(want) === JSON.stringify(k), { want, have: k });

writeFileSync(join(DIR, "results.json"), JSON.stringify({ results, logs: logs.filter((l) => /error|pageerror/i.test(l)) }, null, 2));
await browser.close();
console.log(results.every((r) => r.ok) ? "ALL PASS" : "SOME FAILED");
