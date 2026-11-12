// Compact query entries out of log.md (idempotent). node wiki/scripts/compact-logs.mjs [docId…]
// log.md keeps ingest/plan/merge/finalize/lint/file history plus answered (or saved) queries, one per distinct
// question; every query entry also lands in log-queries.md (the sidecar queryWiki now writes to). Nothing is lost:
// entries moved out of log.md are appended to log-queries.md unless already there.
import { readFile, readdir, rename, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), ".data", "wiki");
const ids = process.argv.slice(2).length ? process.argv.slice(2) : (await readdir(ROOT)).filter((d) => /^[a-f0-9]{16}$/.test(d));
const QHEAD = `---\ntitle: "질의 기록"\ntype: "meta"\n---\n# 질의 기록\n\n> queryWiki 호출 기록(캐시 적중 제외). 답변이 생성·저장된 질의만 [[log]]에도 남는다.\n\n`;
const NOTE = "> 질의(query) 호출 전체 기록은 [[log-queries]]에 있다. 여기에는 답변이 생성·저장된 질의만 남긴다.";

for (const id of ids) {
  const dir = path.join(ROOT, id, "wiki");
  const logF = path.join(dir, "log.md");
  const qF = path.join(dir, "log-queries.md");
  let log;
  try {
    log = await readFile(logF, "utf8");
  } catch {
    continue;
  }
  const lines = log.split("\n");
  const firstEntry = lines.findIndex((l) => l.startsWith("## ["));
  const head = (firstEntry < 0 ? lines : lines.slice(0, firstEntry)).filter((l) => l !== NOTE);
  while (head.length && head[head.length - 1] === "") head.pop();
  const entries = firstEntry < 0 ? [] : lines.slice(firstEntry).filter((l) => l.trim());
  const isQuery = (l) => /^## \[[^\]]*\] query \|/.test(l);
  const keepQ = new Set();
  const kept = [];
  const moved = [];
  for (const l of entries) {
    if (!isQuery(l)) {
      kept.push(l);
      continue;
    }
    moved.push(l);
    const q = l.match(/\| "(.*?)" \|/)?.[1] ?? l;
    const answered = /답변 인용/.test(l) && !/답변 실패/.test(l);
    const saved = /저장 \[\[/.test(l);
    if (saved || (answered && !keepQ.has(q))) {
      keepQ.add(q);
      kept.push(l);
    }
  }
  let existingQ = "";
  try {
    existingQ = await readFile(qF, "utf8");
  } catch {
    /* new */
  }
  const have = new Set(existingQ.split("\n"));
  const add = moved.filter((l) => !have.has(l));
  if (!existingQ) await writeFile(qF, QHEAD);
  if (add.length) await appendFile(qF, add.join("\n") + "\n");
  const out = [...head, "", NOTE, "", ...kept, ""].join("\n");
  if (out !== log) {
    const tmp = `${logF}.${process.pid}.tmp`;
    await writeFile(tmp, out);
    await rename(tmp, logF);
  }
  console.log(`${id}: log.md ${entries.length} → ${kept.length} entries (query ${moved.length} → ${kept.filter(isQuery).length} kept) · log-queries.md +${add.length}`);
}
