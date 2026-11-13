const { GoogleGenAI } = await import("/Users/jyl/work/study/pr-sim/app/node_modules/@google/genai/dist/node/index.mjs");
const withVocab = process.argv[2] === "vocab";
const res = await fetch("http://localhost:3000/api/stt/token", { method: "POST", headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(withVocab ? { vocabulary: ["완충재", "웨이브셀", "3PL", "버섯균사체"] } : {}) });
const tok = await res.json();
console.log("token status", res.status, JSON.stringify(tok.config));
const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: "v1alpha" } });
const out = await new Promise((resolve) => {
  const t = setTimeout(() => resolve("timeout(no setupComplete in 10s)"), 10000);
  ai.live.connect({ model: tok.model, config: tok.config, callbacks: {
    onopen: () => console.log("open"),
    onmessage: (m) => { if (m.setupComplete) { clearTimeout(t); resolve("setupComplete"); } },
    onerror: (e) => console.log("error", e?.message),
    onclose: (e) => { clearTimeout(t); resolve(`closed ${e.code} ${e.reason}`); },
  } }).then((s) => { globalThis.s = s; }).catch((e) => resolve("connect threw " + e.message));
});
console.log(withVocab ? "WITH vocab:" : "WITHOUT vocab:", out);
try { globalThis.s?.close(); } catch {}
process.exit(0);
