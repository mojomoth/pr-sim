import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { errorResponse, readJson } from "@/server/http";

const post = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body) });
const Schema = z.object({
  name: z.string().min(1).max(3),
  age: z.number().int().min(0),
  tags: z.array(z.string()).max(1),
  role: z.enum(["presentation", "proposal"]),
  ids: z.array(z.string()).refine((a) => new Set(a).size === a.length, { message: "심사위원 id가 중복돼요." }),
});

async function issuesOf(body: unknown) {
  const res = await readJson(post(body), Schema).then(
    () => assert.fail("should reject"),
    (e) => errorResponse(e, "test"),
  );
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, "bad_request");
  assert.equal(typeof json.error.message, "string");
  return Object.fromEntries((json.error.issues as { path: string; message: string }[]).map((i) => [i.path, i.message]));
}

test("400 issues carry Korean messages, keeping {error:{code,message,issues}}", async () => {
  assert.deepEqual(await issuesOf({ name: "", age: -1, tags: ["a", "b"], role: "slides", ids: ["a", "a"] }), {
    name: "비어 있으면 안 돼요.",
    age: "0 이상이어야 해요.",
    tags: "1개 이하여야 해요.",
    role: '허용된 값이 아니에요. "presentation", "proposal" 중 하나여야 해요.',
    ids: "심사위원 id가 중복돼요.", // a schema's own message wins
  });
  assert.deepEqual(await issuesOf({ name: "abcd", age: "7", tags: [] }), {
    name: "3자 이하여야 해요.",
    age: "숫자 형식이어야 해요.",
    role: "필수 항목이 빠졌어요.", // a missing enum, not "허용된 값이 아니에요"
    ids: "필수 항목이 빠졌어요.",
  });
});

test("every issue message is Korean (no zod English default leaks)", async () => {
  const issues = await issuesOf({ name: 1, age: 1.5, tags: "x", role: null, ids: [1] });
  for (const m of Object.values(issues)) assert.match(m, /[가-힣]/, m);
});

test("readJson: an empty body returns ifEmpty; without ifEmpty it is still a 400", async () => {
  const empty = () => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" } });
  assert.deepEqual(await readJson(empty(), z.object({ v: z.array(z.string()).optional() }), {}), {});
  const res = await readJson(empty(), Schema).then(
    () => assert.fail("should reject"),
    (e) => errorResponse(e, "test"),
  );
  assert.equal(res.status, 400);
});
