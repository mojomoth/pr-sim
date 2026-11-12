#!/usr/bin/env node
// Copies the pdf.js runtime assets (worker, renderer worker, cmaps, standard fonts, wasm, icc)
// from node_modules/pdfjs-dist into public/slide/pdfjs/ so they are served as same-origin static
// files — no bundler magic, works identically with Turbopack (dev) and `next build`.
// Re-run after upgrading pdfjs-dist:  node slide/scripts/sync-pdfjs.mjs
// The main library is still bundled (import("pdfjs-dist")); pdfjs throws
// "API version does not match Worker version" on mismatch, so version.json is written for checks.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dst = join(root, "public", "slide", "pdfjs");
const { version } = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(join(src, "build", "pdf.worker.min.mjs"), join(dst, "pdf.worker.min.mjs"));
cpSync(join(src, "build", "pdf.renderer.min.mjs"), join(dst, "pdf.renderer.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) cpSync(join(src, dir), join(dst, dir), { recursive: true });
writeFileSync(join(dst, "version.json"), JSON.stringify({ version, syncedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`pdfjs-dist ${version} assets -> public/slide/pdfjs/`);
