// One-off: generate PR-SIM UI imagery with OpenAI gpt-image-2 → public/ui/*.jpg
// Run from pocs/: node ui/scripts/gen-images.mjs [name ...]
import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function loadEnv() {
  for (const f of [".env.local", "../.env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}
loadEnv();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORTRAIT =
  "Photorealistic head-and-shoulders portrait photograph of a fictional Korean adult, natural soft window light, neutral light-gray seamless studio background, calm neutral expression, looking at camera, shallow depth of field, 85mm lens, editorial business headshot, no text, no watermark, no logo.";

export const IMAGES = {
  "hero-stage": {
    size: "1536x1024",
    prompt:
      "Black and white grayscale atmospheric photograph of an empty modern presentation stage in a quiet minimal auditorium: a slim wooden podium with a single thin microphone on the left, a large blank white projection screen on the right wall, soft recessed ceiling spotlights, light-gray paneled walls, a few blurred empty audience seats in the foreground. Calm, soft even lighting, architectural photography, no people, no text, no logos, no watermark.",
  },
  "judge-minseo": {
    size: "1024x1024",
    prompt: `${PORTRAIT} A friendly Korean woman in her mid 40s with a short neat bob haircut, warm gentle slight smile, light beige blazer over a white blouse.`,
  },
  "judge-junho": {
    size: "1024x1024",
    prompt: `${PORTRAIT} A strict Korean man in his mid 50s with round thin metal-framed glasses, short neatly combed graying hair, serious composed face, dark charcoal jacket over a black turtleneck.`,
  },
  "judge-doyun": {
    size: "1024x1024",
    prompt: `${PORTRAIT} A sharp probing Korean man in his early 40s with short dark hair, attentive skeptical gaze, navy suit jacket and white shirt without tie.`,
  },
  "presenter": {
    size: "1024x1536",
    prompt:
      "Photorealistic webcam-style frame of a fictional young Korean presenter in his late 20s speaking towards the camera, short dark hair, dark suit and white shirt, mid-sentence natural expression, plain light-gray office wall behind, soft natural daylight, slightly wide laptop-camera perspective, head and shoulders centered, no text, no watermark, no logo.",
  },
};

async function gen(name) {
  const { size, prompt } = IMAGES[name];
  const t0 = Date.now();
  const res = await client.images.generate({
    model: "gpt-image-2",
    prompt,
    size,
    quality: "high",
    output_format: "jpeg",
    output_compression: 82,
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${name}: no image data`);
  const out = join("public", "ui", `${name}.jpg`);
  mkdirSync(join("public", "ui"), { recursive: true });
  writeFileSync(out, Buffer.from(b64, "base64"));
  console.log(`${name}: ${out} ${size} ${(Date.now() - t0) / 1000}s ${Math.round(Buffer.from(b64, "base64").length / 1024)}KB`);
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(IMAGES);
const results = await Promise.allSettled(names.map(gen));
results.forEach((r, i) => r.status === "rejected" && console.error(`${names[i]} FAILED: ${r.reason?.message ?? r.reason}`));
