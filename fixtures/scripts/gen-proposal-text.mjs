// Generates the proposal (사업계획서) chapter bodies with an LLM (OpenAI gpt-5.4-mini shipped; Claude Sonnet 5.5 / Gemini selectable), in parallel.
// Run from pocs/:  node --env-file=.env.local fixtures/scripts/gen-proposal-text.mjs [--provider claude|gemini|openai] [--force] [chNN ...]
// NOTE 2026-11-12: the Claude key hit its usage limit (400 "API usage limits") and the Gemini key is Free Tier
// (tiny daily quotas shared with the STT/TTS PoC), so the shipped text was generated with --provider openai (gpt-5.4-mini).
// The Claude path (claude-sonnet-5-5) is kept for regeneration once the quota resets.
// Output: fixtures/src/proposal/chNN.html (HTML fragments). Existing files are skipped unless --force.
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FACT_SHEET } from "./facts.mjs";

const OUT = join(process.cwd(), "fixtures", "src", "proposal");
mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const PROVIDER = argv.includes("--provider") ? argv[argv.indexOf("--provider") + 1] : "claude";
const MODEL = { gemini: "gemini-3.8-flash", openai: "gpt-5.4-mini", claude: "claude-sonnet-5-5" }[PROVIDER];
const oai = PROVIDER === "openai" ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const client = PROVIDER === "claude" ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;
const gem = PROVIDER === "gemini" ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY }) : null;

async function complete(text) {
  if (oai) {
    const r = await oai.responses.create({ model: MODEL, input: text, reasoning: { effort: "low" }, max_output_tokens: 32000 });
    return { text: r.output_text, outTok: r.usage?.output_tokens, stop: r.status };
  }
  if (gem) {
    const r = await gem.models.generateContent({ model: MODEL, contents: text, config: { maxOutputTokens: 32000 } });
    return { text: r.text ?? "", outTok: r.usageMetadata?.candidatesTokenCount, stop: r.candidates?.[0]?.finishReason };
  }
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    messages: [{ role: "user", content: text }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("refused");
  return { text: msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""), outTok: msg.usage.output_tokens, stop: msg.stop_reason };
}

import { CHAPTERS } from "./chapters.mjs";

// The proposal's own fact sheet: same as the deck EXCEPT the deliberate inconsistencies (unit cost, SOM).
const PROPOSAL_FACTS = FACT_SHEET.replace("# 가격 / 원가 (발표덱 기준)", "# 가격 / 원가")
  .replace("- 웨이브셀 원가 세트당 118원 (2026년 양산 기준, 매출총이익률 약 28%) ← 발표덱 수치", "- 웨이브셀 원가 세트당 142원 (2026년 양산 기준, 매출총이익률 약 14%)")
  .replace("# 시장 (발표덱 기준)", "# 시장")
  .replace("- SOM: 2029년 340억 원 (SAM의 5%) ← 발표덱 수치", "- SOM: 2029년 210억 원 (SAM의 약 3.1%)")
  .replace("# 재무 계획 (발표덱 기준, 억 원)", "# 재무 계획 (억 원)");
if (/118원|340억|발표덱/.test(PROPOSAL_FACTS)) throw new Error("proposal fact sheet still contains deck-only values");

function prompt(ch, idx) {
  return `당신은 한국 스타트업의 사업계획서(투자 심사 제출용 제안서)를 쓰는 전문 작가입니다.
아래 [팩트 시트]를 사실의 기준으로 삼아, 사업계획서의 ${idx + 1}장 "${ch.title}"의 본문을 작성하세요.

[이 장의 내용]
${ch.brief}

[반드시 지킬 사항]
${["팩트 시트에 있는 수치와 고유명사를 그대로 사용하고, 없는 세부 수치는 팩트와 모순되지 않게 구체적으로 만들어 넣는다.", "실존 기업·기관의 이름은 쓰지 않는다(필요하면 'A사', '대형 물류기업'처럼 익명화).", "본문에 '팩트 시트', '제시된 수치', '지침' 같은 작성 과정에 대한 언급을 절대 쓰지 않는다. 독자는 이 문서만 읽는다. 수치의 출처는 '당사 파일럿 실적', '출고 전표 기준', '공개 통계' 등 실제 사업계획서에 있을 법한 표현으로 쓴다.", ...ch.pin].map((s) => "- " + s).join("\n")}

[출력 형식]
- HTML 조각만 출력한다. 마크다운, 코드 펜스(\`\`\`), <html>/<head>/<body>/<style>/<script> 태그 금지.
- 첫 줄은 <h2>${idx + 1}. ${ch.title}</h2>. 이후 <h3>${idx + 1}.1 ...</h3> 형식의 소제목, <p>, <ul>/<ol>/<li>, <strong>, <table>(<thead>/<tbody>/<tr>/<th>/<td>), <blockquote>만 사용한다.
- 표는 최소 1개 이상, 숫자는 단위를 명확히.
- 분량: 태그를 제외한 한글 본문 최소 7,000자 이상(소제목 6~8개, 각 소제목마다 2~4개 문단). 짧게 끝내지 말 것. 문어체(~이다/~한다) 사업계획서 어조. 장 밖의 내용(다른 장 제목, 결론 인사말)은 쓰지 않는다.

[팩트 시트]
${PROPOSAL_FACTS}`;
}

async function gen(ch, idx) {
  const t0 = Date.now();
  const r = await complete(prompt(ch, idx));
  let html = r.text;
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  writeFileSync(join(OUT, `${ch.id}.html`), html);
  const chars = html.replace(/<[^>]+>/g, "").length;
  console.log(`${ch.id} ${ch.title}: ${chars} chars, ${r.outTok} out tok, ${((Date.now() - t0) / 1000).toFixed(1)}s, stop=${r.stop}`);
}

const force = argv.includes("--force");
const only = argv.filter((a) => /^ch\d+$/.test(a));
const todo = CHAPTERS.map((c, i) => [c, i]).filter(([c]) => (only.length ? only.includes(c.id) : true) && (force || !existsSync(join(OUT, `${c.id}.html`))));
console.log(`generating ${todo.length} chapters with ${MODEL}`);
const res = await Promise.allSettled(todo.map(([c, i]) => gen(c, i)));
res.forEach((r, k) => r.status === "rejected" && console.error(`FAILED ${todo[k][0].id}:`, r.reason?.message ?? r.reason));
