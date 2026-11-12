// Reviewer: build labeled contact sheet of given judge ids via the served API (full image).
import sharp from "sharp";
const [out, ...ids] = process.argv.slice(2);
const S = Number(process.env.S ?? 512);
const tiles = [];
for (const id of ids) {
  const r = await fetch(`http://localhost:3100/api/judge/image/${id}`);
  if (!r.ok || !String(r.headers.get("content-type")).startsWith("image/")) { console.error("BAD", id, r.status, r.headers.get("content-type")); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  tiles.push(await sharp(buf).resize(S, S).jpeg().toBuffer());
}
const cols = Number(process.env.C ?? 3), rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * S, height: rows * S, channels: 3, background: "#fff" } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * S, top: Math.floor(i / cols) * S })))
  .jpeg({ quality: 85 }).toFile(out);
console.log("wrote", out);
