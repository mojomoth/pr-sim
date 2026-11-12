// Same-origin calls from the real app page (ALLOWED_ORIGINS unset): routes wrapped with cors() still work,
// readable x-* headers, 413 on a > 4MB streamed body, OPTIONS unchanged. Screenshot shows the result on the page.
import { launch, shot } from "../../../../pocs/scripts/browser.mjs";
import { writeFileSync } from "node:fs";
const { browser, page, logs } = await launch({ mobile: true });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
const r = await page.evaluate(async () => {
  const out = {};
  const tts = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "답변 감사합니다.", gender: "male", age: 52, temperament: "strict" }) });
  out.tts = { status: tts.status, provider: tts.headers.get("x-provider"), model: tts.headers.get("x-model"), duration: tts.headers.get("x-duration"), acao: tts.headers.get("access-control-allow-origin"), bytes: (await tts.arrayBuffer()).byteLength };
  const big = await fetch("/api/wiki", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(4_200_000) });
  out.big = { status: big.status, body: await big.json() };
  const opt = await fetch("/api/report", { method: "OPTIONS" });
  out.options = { status: opt.status, allow: opt.headers.get("allow"), acao: opt.headers.get("access-control-allow-origin") };
  const tok = await fetch("/api/stt/token", { method: "POST" });
  out.token = { status: tok.status, hasToken: !!(await tok.json()).token };
  const pre = document.createElement("pre");
  pre.id = "g3-api-check";
  pre.style.cssText = "position:fixed;inset:auto 8px 8px 8px;z-index:99999;background:#fff;color:#000;font:11px/1.35 monospace;padding:8px;border:1px solid #000;white-space:pre-wrap;max-height:60vh;overflow:auto";
  pre.textContent = "G3 API P2 — same-origin checks\n" + JSON.stringify(out, null, 1);
  document.body.appendChild(pre);
  return out;
});
await shot(page, new URL("browser-check.png", import.meta.url).pathname);
writeFileSync(new URL("browser-check.out.json", import.meta.url), JSON.stringify({ result: r, logs: logs.filter((l) => /error|fail/i.test(l)) }, null, 2));
console.log(JSON.stringify(r, null, 2));
await browser.close();
