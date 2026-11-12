// Deployed API probes: bad bodies, 413 at ~5MB, TTS provider, token route. Never prints tokens/keys.
import { writeFileSync } from "node:fs";
const BASE = "https://pr-sim-lake.vercel.app";
const H = { "content-type": "application/json", origin: BASE };
const out = {};
async function post(path, body, headers = H) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { method: "POST", headers, body });
  const ct = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { status: res.status, ms: Date.now() - t0, ct, cache: res.headers.get("cache-control"), vercelId: res.headers.get("x-vercel-id"), vercelError: res.headers.get("x-vercel-error"),
    provider: res.headers.get("x-provider"), model: res.headers.get("x-model"), bytes: buf.length,
    body: json ? (json.token ? { ...json, token: `<${json.token.length} chars>` } : json) : ct.includes("html") || ct.includes("text") ? buf.toString().slice(0, 200) : undefined };
}
out.empty = {};
for (const r of ["/api/tts", "/api/judges", "/api/wiki", "/api/questions", "/api/questions/followup", "/api/report"]) out.empty[r] = await post(r, undefined);
out.malformed = await post("/api/tts", "{not json");
out.badFields = await post("/api/tts", JSON.stringify({ text: "", gender: "x", age: 5, temperament: "friendly" }));
out.wikiBadDoc = await post("/api/wiki", JSON.stringify({ doc: { role: "slides" } }));
const big = JSON.stringify({ doc: { role: "proposal", docId: "0123456789abcdef", filename: "big.pdf", pageTexts: Array.from({ length: 100 }, () => "가".repeat(17_000)) } });
out.wiki5mb = { sentBytes: Buffer.byteLength(big), ...(await post("/api/wiki", big)) };
const big46 = JSON.stringify({ doc: { role: "proposal", docId: "0123456789abcdef", filename: "big.pdf", pageTexts: Array.from({ length: 100 }, () => "a".repeat(47_000)) } });
out.wiki47mbAscii = { sentBytes: Buffer.byteLength(big46), ...(await post("/api/wiki", big46)) };
out.tokenNoOrigin = await post("/api/stt/token", undefined, {});
out.token = await post("/api/stt/token", undefined, { origin: BASE });
out.tts = await post("/api/tts", JSON.stringify({ text: "안녕하세요. 첫 번째 질문 드리겠습니다.", gender: "male", age: 45, temperament: "friendly" }));
writeFileSync(new URL("./api-probes.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, (k, v) => (k === "body" && typeof v === "object" ? JSON.stringify(v).slice(0, 160) : v), 1));
