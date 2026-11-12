import assert from "node:assert/strict";
import { test } from "node:test";
import { FollowUpIn, GenerateIn } from "@/server/question/schema";
import { ReportIn } from "@/server/report/schema";
import { checkDocLimits, DocIn, TranscriptIn } from "@/server/wiki/schema";
import { MAX_DOC_CHARS, MAX_DOC_PAGES } from "@/server/types";

const doc = (over: object = {}) => ({ role: "presentation", docId: "0123456789abcdef", filename: "deck.pdf", pageTexts: ["가".repeat(100)], ...over });
const judge = { id: "j1", name: "준호", temperament: "strict", gender: "male", age: 40 };
const sentence = { id: "s1", t: 1.5, text: "안녕하세요.", phase: "presentation" };

test("DocIn accepts a well-formed doc and rejects bad ids, roles and empty pages", () => {
  assert.ok(DocIn.safeParse(doc()).success);
  assert.equal(DocIn.safeParse(doc({ docId: "XYZ" })).success, false);
  assert.equal(DocIn.safeParse(doc({ role: "slides" })).success, false);
  assert.equal(DocIn.safeParse(doc({ pageTexts: [] })).success, false);
  assert.equal(DocIn.safeParse({}).success, false);
});

test("TranscriptIn caps t at 6 hours and needs text", () => {
  assert.ok(TranscriptIn.safeParse(sentence).success);
  assert.equal(TranscriptIn.safeParse({ ...sentence, t: 6 * 3600 + 1 }).success, false);
  assert.equal(TranscriptIn.safeParse({ ...sentence, t: -1 }).success, false);
  assert.equal(TranscriptIn.safeParse({ ...sentence, text: "" }).success, false);
});

test("checkDocLimits: 413 over the page/char caps, 422 for scanned PDFs", () => {
  assert.doesNotThrow(() => checkDocLimits(doc() as never));
  assert.throws(() => checkDocLimits(doc({ pageTexts: Array(MAX_DOC_PAGES + 1).fill("가".repeat(30)) }) as never), { code: "too_large" });
  assert.throws(() => checkDocLimits(doc({ pageTexts: ["가".repeat(MAX_DOC_CHARS + 1)] }) as never), { code: "too_large" });
  assert.throws(() => checkDocLimits(doc({ pageTexts: ["", "", "", "가".repeat(60)] }) as never), { code: "unsupported" });
});

test("GenerateIn rejects missing docs, duplicate roles, too many or duplicate judges", () => {
  const ok = { qaMinutes: 3, transcript: [sentence], docs: [doc()], judges: [judge] };
  assert.ok(GenerateIn.safeParse(ok).success);
  assert.equal(GenerateIn.safeParse({ ...ok, docs: [] }).success, false);
  assert.equal(GenerateIn.safeParse({ ...ok, docs: [doc(), doc()] }).success, false);
  assert.equal(GenerateIn.safeParse({ ...ok, judges: [judge, judge] }).success, false);
  assert.equal(GenerateIn.safeParse({ ...ok, judges: [1, 2, 3, 4].map((i) => ({ ...judge, id: `j${i}` })) }).success, false);
  assert.equal(GenerateIn.safeParse({ ...ok, qaMinutes: 0 }).success, false);
});

test("FollowUpIn truncates long answers to 4000 chars instead of rejecting", () => {
  const q = { id: "q1", judgeId: "j1", question: "왜요?", intent: "", targetClaim: "", evidence: [], difficulty: 3, kind: "main" };
  const body = { packText: "", judge, asked: q, original: q, answer: "가".repeat(5000), thread: [], followupsSoFar: 0, pending: [], transcript: [], docs: [] };
  const r = FollowUpIn.safeParse(body);
  assert.ok(r.success);
  assert.ok(r.data.answer.startsWith("가".repeat(4000)));
  assert.match(r.data.answer, /1,000자 생략/);
  assert.equal(FollowUpIn.safeParse({ ...body, judge: { ...judge, age: 10 } }).success, false);
});

test("ReportIn needs a session with at least one doc and a known provider", () => {
  const session = { id: "r1", situation: "", presentationMinutes: 5, qaMinutes: 3, judges: [], transcript: [sentence], qa: [], docs: [doc()] };
  assert.ok(ReportIn.safeParse({ session }).success);
  assert.equal(ReportIn.safeParse({ session: { ...session, docs: [] } }).success, false);
  assert.equal(ReportIn.safeParse({ session, provider: "mistral" }).success, false);
  assert.equal(ReportIn.safeParse({}).success, false);
});
