import { test } from "node:test";
import { pickVoice, voiceSeed } from "@/platform/web/speech";
test("probe", () => {
  console.log("empty male", JSON.stringify(pickVoice([], "male", 7)));
  console.log("empty female", JSON.stringify(pickVoice([], "female", -3)));
  console.log("non-ko only", JSON.stringify(pickVoice([{ name: "Samantha", lang: "en-US" }], "male", 2)));
  console.log("novelty only female", JSON.stringify(pickVoice([{ name: "Flo (한국어)", lang: "ko-KR" }], "male", 9)));
  console.log("seed", voiceSeed({ gender: "male", age: 45, temperament: "strict" }), voiceSeed({ gender: "female", age: 30, temperament: "friendly" }));
});
