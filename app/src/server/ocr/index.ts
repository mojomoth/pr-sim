import "server-only";
import { gemini, LITE_FALLBACK, openai, quotaAwareFetch } from "@/server/ai";

// Image → text for slides without a text layer (scanned / image-exported PDFs).
// Chain: OpenAI (repo default, docs/dev-v1/report.md) → Gemini Flash → Gemini lite models. Any provider error moves on
// to the next model; the call fails only when every model failed.

const OPENAI_MODEL = "gpt-6.1-terra";
const GEMINI_MODELS = ["gemini-3.5-flash", ...LITE_FALLBACK] as const;

const PROMPT = `이 이미지는 발표 자료의 한 쪽입니다. 보이는 글자를 모두 그대로 옮겨 적으세요.
- 제목, 본문, 표, 차트의 축·범례·수치, 각주, 쪽 번호까지 빠짐없이 옮깁니다.
- 숫자·단위·고유명사는 이미지에 적힌 그대로 씁니다. 고치거나 번역하지 않습니다.
- 위에서 아래, 왼쪽에서 오른쪽 순서로 쓰고, 덩어리 사이는 빈 줄로 나눕니다.
- 설명이나 요약, 마크다운 기호는 붙이지 않습니다.
- 글자가 하나도 없으면 아무것도 출력하지 않습니다.`;

export interface OcrResult {
  text: string;
  model: string;
}

/** Transcribe one page image (base64 JPEG). */
export async function ocrPage(jpegBase64: string, signal?: AbortSignal): Promise<OcrResult> {
  let last: unknown;
  for (const model of [OPENAI_MODEL, ...GEMINI_MODELS]) {
    signal?.throwIfAborted();
    try {
      const text = model === OPENAI_MODEL ? await viaOpenai(jpegBase64, signal) : await viaGemini(model, jpegBase64, signal);
      return { text: clean(text), model };
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
      console.warn(`[ocr] ${model} failed:`, e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  const err = new Error(`ocr: every model failed (${last instanceof Error ? last.message.slice(0, 120) : "unknown"})`);
  err.name = "ProvidersUnavailableError";
  throw err;
}

const clean = (s: string) =>
  s
    .replace(/^```[a-z]*\n?|\n?```$/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

async function viaOpenai(img: string, signal?: AbortSignal): Promise<string> {
  const r = await openai()
    .withOptions({ maxRetries: 1, timeout: 45_000, fetch: quotaAwareFetch })
    .responses.create(
      {
        model: OPENAI_MODEL,
        reasoning: { effort: "none" },
        max_output_tokens: 4000,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: PROMPT },
              { type: "input_image", image_url: `data:image/jpeg;base64,${img}`, detail: "high" },
            ],
          },
        ],
      },
      { signal },
    );
  if (r.status === "incomplete") throw new Error(`openai incomplete: ${r.incomplete_details?.reason ?? "unknown"}`);
  return r.output_text;
}

async function viaGemini(model: string, img: string, signal?: AbortSignal): Promise<string> {
  const r = await gemini().models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: { mimeType: "image/jpeg", data: img } }] }],
    config: { maxOutputTokens: 4000, abortSignal: signal, httpOptions: { timeout: 45_000 } },
  });
  const finish = r.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") throw new Error(`gemini finish ${finish}`);
  return r.text ?? "";
}
