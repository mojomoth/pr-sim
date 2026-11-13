// API smoke test against a running server (default http://localhost:3000, override with BASE_URL).
// Only cheap paths: validation errors never reach a model; the token route mints one free Live token.
// Never prints tokens or keys.
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { test } from "node:test";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
// Own rate-limit bucket per run, so re-running within a minute does not hit 429 (local server only).
const CLIENT = { "x-forwarded-for": `smoke-${process.pid}-${Date.now()}` };

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...CLIENT, ...headers },
    body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, json };
}

function assertError(r, status, code) {
  assert.equal(r.status, status, `expected ${status}, got ${r.status}: ${JSON.stringify(r.json)?.slice(0, 200)}`);
  assert.equal(r.json?.error?.code, code);
  assert.equal(typeof r.json.error.message, "string");
  assert.match(r.json.error.message, /[가-힣]/, "error message is Korean");
  assert.equal(r.headers.get("cache-control"), "no-store");
}

const ROUTES = ["/api/tts", "/api/judges", "/api/wiki", "/api/questions", "/api/questions/followup", "/api/report"];

test("server is up", async () => {
  const res = await fetch(BASE + "/", { headers: CLIENT });
  assert.equal(res.status, 200);
});

for (const route of ROUTES) {
  test(`${route}: empty body → 400 bad_request`, async () => {
    assertError(await post(route, undefined), 400, "bad_request");
  });
}

test("/api/tts: malformed JSON and invalid fields → 400", async () => {
  assertError(await post("/api/tts", "{not json"), 400, "bad_request");
  assertError(await post("/api/tts", { text: "", gender: "male", age: 40, temperament: "friendly" }), 400, "bad_request");
});

test("/api/wiki: bad doc → 400, scanned-looking doc → 422", async () => {
  assertError(await post("/api/wiki", { doc: { role: "slides" } }), 400, "bad_request");
  const doc = { role: "presentation", docId: "0123456789abcdef", filename: "scan.pdf", pageTexts: ["", "", "", "짧음"] };
  assertError(await post("/api/wiki", { doc }), 422, "unsupported");
});

test("body over 4MB → 413 too_large", async () => {
  const big = JSON.stringify({ text: "가".repeat(1_400_000), gender: "male", age: 40, temperament: "friendly" });
  assert.ok(new Blob([big]).size > 4_000_000);
  assertError(await post("/api/tts", big), 413, "too_large");
});

test("chunked body over 4MB (no content-length) → 413 too_large", async () => {
  // node:http(s) on its own socket (agent: false): the server stops reading mid-body, so this socket is not reused.
  const url = new URL(BASE + "/api/tts");
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const chunk = Buffer.from("가".repeat(21_845)); // ~64KB
  const res = await new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", agent: false, headers: { "content-type": "application/json", ...CLIENT } }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d));
      r.on("end", () => resolve({ status: r.statusCode, body: b, chunked: req.getHeader("content-length") === undefined }));
    });
    req.on("error", reject);
    let sent = 0;
    const pump = () => {
      while (sent < 66) {
        sent++; // 66 × 64KB ≈ 4.3MB: over MAX_BODY_BYTES (4MB), under Vercel's 4.5MB edge limit (which answers in plain text)
        if (!req.write(chunk)) return void req.once("drain", pump);
      }
      req.end();
    };
    pump();
  });
  assert.ok(res.chunked);
  assert.equal(res.status, 413);
  assert.equal(JSON.parse(res.body).error.code, "too_large");
});

test("cross-site browser calls are refused on every route", async () => {
  for (const route of [...ROUTES, "/api/stt/token"]) {
    assertError(await post(route, {}, { "sec-fetch-site": "cross-site", origin: "https://evil.example" }), 403, "forbidden");
  }
});

test("/api/stt/token is strict: bare request and foreign Origin → 403", async () => {
  assertError(await post("/api/stt/token", undefined), 403, "forbidden");
  assertError(await post("/api/stt/token", undefined, { origin: "https://evil.example" }), 403, "forbidden");
});

test("/api/stt/token from our own page → short-lived token, no-store", async () => {
  const r = await post("/api/stt/token", undefined, { "sec-fetch-site": "same-origin" });
  assert.equal(r.status, 200, JSON.stringify(r.json?.error ?? null));
  assert.equal(typeof r.json.token, "string");
  assert.ok(r.json.token.length > 10);
  assert.equal(typeof r.json.model, "string");
  assert.ok(Date.parse(r.json.expiresAt) > Date.now());
  assert.equal(r.headers.get("cache-control"), "no-store");
});
