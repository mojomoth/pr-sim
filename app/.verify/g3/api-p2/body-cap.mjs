// Chunked (no content-length) bodies: > 4MB must be 413 while streaming; a small chunked body still parses.
import http from "node:http";
function post(path, chunks, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "localhost", port: 3000, path, method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode, te: req.getHeader("transfer-encoding") ?? "chunked(auto)", cl: req.getHeader("content-length") ?? null, body: b.slice(0, 300) }));
    });
    req.on("error", (e) => resolve({ error: e.code || e.message }));
    let i = 0;
    const pump = () => {
      while (i < chunks.length) { if (!req.write(chunks[i++])) return req.once("drain", pump); }
      req.end();
    };
    pump();
  });
}
const out = {};
// 6MB in 64KB chunks, never sending content-length
const big = Array.from({ length: 96 }, (_, i) => (i === 0 ? '{"text":"' : "") + "가".repeat(21_845));
out.chunked6mb = await post("/api/tts", big);
out.chunkedSmallInvalid = await post("/api/tts", ['{"text":', '"안녕"}']);
out.chunkedNotJson = await post("/api/tts", ["{not json"]);
out.emptyBody = await post("/api/tts", []);
out.contentLengthOver = await new Promise((r) => {
  const req = http.request({ host: "localhost", port: 3000, path: "/api/wiki", method: "POST", headers: { "content-type": "application/json", "content-length": "5000000" } }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => r({ status: res.statusCode, body: b })); });
  req.on("error", (e) => r({ error: e.code })); req.write("{"); setTimeout(() => req.destroy(), 3000);
});
console.log(JSON.stringify(out, null, 2));
