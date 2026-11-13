import assert from "node:assert/strict";
import { test } from "node:test";
import { faceNotice } from "@/app/setup/faceNotice";

test("no notice for zero or one missing face", () => {
  assert.equal(faceNotice([{ hasFace: true }, { hasFace: true }]), null);
  assert.equal(faceNotice([{ hasFace: false, errorCode: "timeout" }, { hasFace: true }]), null);
});

test("pending rows are not counted", () => {
  assert.equal(faceNotice([{ hasFace: false, errorCode: "timeout" }, { hasFace: false, pending: true }]), null);
});

test("same known cause names it", () => {
  const n = faceNotice([{ hasFace: false, errorCode: "rate_limited" }, { hasFace: false, errorCode: "rate_limited" }, { hasFace: true }]);
  assert.equal(n?.count, 2);
  assert.match(n!.message, /^얼굴 사진 요청이 몰려서/);
  assert.equal(n!.message, "얼굴 사진 요청이 몰려서 지금은 사진을 만들 수 없어요. 심사위원 2명은 사진 대신 이름 첫 글자로 표시해요. 발표는 그대로 시작할 수 있어요.");
});

test("same unknown cause falls back to the image-service sentence", () => {
  const n = faceNotice([{ hasFace: false, errorCode: "upstream" }, { hasFace: false, errorCode: "upstream" }]);
  assert.match(n!.message, /^얼굴 사진을 만드는 이미지 서비스를/);
});

test("mixed causes still give one notice", () => {
  const n = faceNotice([{ hasFace: false, errorCode: "rate_limited" }, { hasFace: false, errorCode: "timeout" }, { hasFace: false, errorCode: "store" }]);
  assert.equal(n?.count, 3);
  assert.equal(n!.message, "심사위원 3명의 얼굴 사진을 만들지 못했어요. 사진 대신 이름 첫 글자로 표시해요. 발표는 그대로 시작할 수 있어요.");
});

test("after reload (no codes, only saved judges without photos) the notice stays", () => {
  const n = faceNotice([{ hasFace: false }, { hasFace: false }, { hasFace: true }]);
  assert.equal(n?.count, 2);
  assert.match(n!.message, /^심사위원 2명의 얼굴 사진을 만들지 못했어요/);
});
