// /api/wiki on the deployed URL: 58-page proposal build time (stream until done/error), app-level 413s.
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "https://pr-sim-lake.vercel.app";
const S = process.argv[2];
const H = { "content-type": "application/json", origin: BASE };
const out = {};
async function stream(name, doc) {
  const t0 = Date.now(); const ev = [];
  const res = await fetch(BASE + "/api/wiki", { method: "POST", headers: H, body: JSON.stringify({ doc }) });
  const head = { status: res.status, ct: res.headers.get("content-type"), vercelError: res.headers.get("x-vercel-error"), headersMs: Date.now() - t0 };
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
      try { const j = JSON.parse(line); ev.push({ ms: Date.now() - t0, type: j.type, phase: j.phase, chunksDone: j.chunksDone, chunksTotal: j.chunksTotal, code: j.code, message: j.message, pages: j.wiki?.length }); } catch { ev.push({ ms: Date.now() - t0, raw: line.slice(0, 200) }); } } }
  if (buf.trim()) ev.push({ ms: Date.now() - t0, raw: buf.slice(0, 300) });
  out[name] = { ...head, totalMs: Date.now() - t0, events: ev.length, first: ev[0], last: ev.at(-1), progress: ev.filter((e) => e.type === "progress").slice(-3) };
  console.log(name, JSON.stringify(out[name]).slice(0, 600));
}
const prop = JSON.parse(readFileSync(`${S}/proposal.json`, "utf8"));
const pres = JSON.parse(readFileSync(`${S}/presentation.json`, "utf8"));
await stream("proposal58", { role: "proposal", docId: prop.docId, filename: "proposal.pdf", pageTexts: prop.pageTexts });
await stream("presentation12", { role: "presentation", docId: pres.docId, filename: "presentation.pdf", pageTexts: pres.pageTexts });
// app-level limits (JSON 413, below the 4.5MB platform cap)
const r121 = await fetch(BASE + "/api/wiki", { method: "POST", headers: H, body: JSON.stringify({ doc: { role: "proposal", docId: "0123456789abcdef", filename: "x.pdf", pageTexts: Array.from({ length: 121 }, (_, i) => `쪽 ${i + 1} 내용 텍스트`) } }) });
out.pages121 = { status: r121.status, body: (await r121.text()).slice(0, 200) };
const b42 = JSON.stringify({ doc: { role: "proposal", docId: "0123456789abcdef", filename: "x.pdf", pageTexts: Array.from({ length: 100 }, () => "a".repeat(42_000)) } });
const r42 = await fetch(BASE + "/api/wiki", { method: "POST", headers: H, body: b42 });
out.body4_2mb = { sentBytes: Buffer.byteLength(b42), status: r42.status, ct: r42.headers.get("content-type"), body: (await r42.text()).slice(0, 200) };
console.log(JSON.stringify({ pages121: out.pages121, body4_2mb: out.body4_2mb }));
writeFileSync(new URL("./wiki-timing.json", import.meta.url), JSON.stringify(out, null, 2));
