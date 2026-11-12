// ALLOWED_ORIGINS set (the running dev server cannot be restarted with a new env, so the real
// src/server/http module is loaded here with jiti under the react-server condition).
import { createJiti } from "../../../node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../../../src", import.meta.url).pathname, "server-only": new URL("../../../node_modules/.pnpm/server-only@0.0.1/node_modules/server-only/empty.js", import.meta.url).pathname } });
const http = await jiti.import("../../../src/server/http/index.ts");
const req = (h, body) => new Request("http://localhost:3000/api/tts", { method: body ? "POST" : "OPTIONS", headers: h, body, duplex: "half" });
const hdrs = (r) => Object.fromEntries([...r.headers].filter(([k]) => /^(access-control|vary|allow)/.test(k)));
const out = {};
const run = async (label) => {
  const native = { origin: "capacitor://localhost", "sec-fetch-site": "cross-site", "access-control-request-headers": "content-type" };
  const evil = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
  const POST = http.cors(async (r) => http.guard(r, "tts") ?? Response.json({ ok: true }));
  const pTok = (h) => http.sameOrigin(new Request("http://x/api/stt/token", { method: "POST", headers: h }), true);
  out[label] = {
    preflightNative: { status: http.preflight(req(native)).status, headers: hdrs(http.preflight(req(native))) },
    preflightEvil: { status: http.preflight(req(evil)).status, headers: hdrs(http.preflight(req(evil))) },
    postNative: await POST(req(native, "{}")).then(async (r) => ({ status: r.status, headers: hdrs(r) })),
    postEvil: await POST(req(evil, "{}")).then(async (r) => ({ status: r.status, headers: hdrs(r) })),
    tokenStrictNativeNoFetchMeta: pTok({ origin: "capacitor://localhost" }),
    tokenStrictSameSite: pTok({ "sec-fetch-site": "same-origin" }),
    tokenStrictEvil: pTok({ origin: "https://evil.example" }),
  };
};
delete process.env.ALLOWED_ORIGINS;
await run("unset");
process.env.ALLOWED_ORIGINS = "capacitor://localhost, http://localhost/";
await run("set");
console.log(JSON.stringify(out, null, 2));
