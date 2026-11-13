const { GoogleGenAI } = await import("/Users/jyl/work/study/pr-sim/app/node_modules/@google/genai/dist/node/index.mjs");
const mode = process.argv[2];
const vocab = mode === "max" ? Array.from({ length: 60 }, (_, i) => `용어${i}`.padEnd(40, "가")) : mode === "vocab" ? ["완충재", "웨이브셀", "3PL"] : undefined;
const res = await fetch("http://localhost:3000/api/stt/token", { method: "POST", headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin", ...(vocab ? { "content-type": "application/json" } : {}) }, body: vocab ? JSON.stringify({ vocabulary: vocab }) : undefined });
const tok = await res.json();
console.log(mode, "token status", res.status, "keys", Object.keys(tok).join(","), "vocabN", tok.config?.inputAudioTranscription?.customVocabulary?.length ?? 0, "tokenPrefix", String(tok.token).slice(0, 12));
if (res.status !== 200) { console.log(JSON.stringify(tok)); process.exit(0); }
const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: "v1alpha" } });
const out = await new Promise((resolve) => {
  const t = setTimeout(() => resolve("timeout"), 10000);
  ai.live.connect({ model: tok.model, config: tok.config, callbacks: {
    onmessage: (m) => { if (m.setupComplete) { clearTimeout(t); resolve("setupComplete"); } },
    onerror: (e) => console.log("error", e?.message),
    onclose: (e) => { clearTimeout(t); resolve(`closed ${e.code} ${e.reason}`); },
  } }).then((s) => { globalThis.s = s; }).catch((e) => resolve("connect threw " + e.message));
});
console.log(mode, "live:", out);
try { globalThis.s?.close(); } catch {}
process.exit(0);
