#!/usr/bin/env node
// Append a development event for the multi-agent observability dashboard (/devlog).
// Usage: node scripts/devlog.mjs <poc> <status> "<message>" [--agent name] [--file path]
//   status: queued | in_progress | verifying | done | failed | note | issue | fixed
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const [poc, status, ...rest] = pos;
if (!poc || !status) {
  console.error('usage: node scripts/devlog.mjs <poc> <status> "<message>" [--agent name] [--file path]');
  process.exit(1);
}
const evt = { ts: new Date().toISOString(), poc, status, msg: rest.join(" "), agent: flags.agent ?? `${poc}-agent`, file: flags.file };
mkdirSync(join(root, "devlog"), { recursive: true });
appendFileSync(join(root, "devlog", "events.jsonl"), JSON.stringify(evt) + "\n");
console.log("devlog:", evt.poc, evt.status, evt.msg);
