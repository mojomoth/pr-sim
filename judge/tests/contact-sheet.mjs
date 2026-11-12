// Build a labelled contact sheet of judge portraits for visual review.
// usage: node judge/tests/contact-sheet.mjs [out.jpg] [limit] [cell]
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
const BASE = process.env.POC_BASE ?? "http://localhost:3100";
const out = process.argv[2] ?? ".verify/judge/contact.jpg";
const limit = Number(process.argv[3] ?? 12);
const cell = Number(process.argv[4] ?? 400);
const { judges } = await (await fetch(`${BASE}/api/judge`)).json();
const list = judges.slice(0, limit);
const cols = Math.min(3, list.length);
const rows = Math.ceil(list.length / cols);
const label = 40;
const tiles = await Promise.all(
  list.map(async (j, i) => {
    const buf = Buffer.from(await (await fetch(BASE + j.imageUrl)).arrayBuffer());
    const img = await sharp(buf).resize(cell, cell).toBuffer();
    const text = `${j.fullName} · ${j.temperament} · ${j.gender === "male" ? "M" : "F"}${j.age} · ${(j.ms / 1000).toFixed(1)}s ${j.quality}`;
    const svg = Buffer.from(`<svg width="${cell}" height="${label}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="10" y="26" font-family="Apple SD Gothic Neo, sans-serif" font-size="17" fill="#fff">${text}</text></svg>`);
    return [
      { input: img, left: (i % cols) * cell, top: Math.floor(i / cols) * (cell + label) },
      { input: svg, left: (i % cols) * cell, top: Math.floor(i / cols) * (cell + label) + cell },
    ];
  }),
);
mkdirSync(dirname(out), { recursive: true });
await sharp({ create: { width: cols * cell, height: rows * (cell + label), channels: 3, background: "#fff" } })
  .composite(tiles.flat())
  .jpeg({ quality: 85 })
  .toFile(out);
console.log(out, list.length, "judges");
