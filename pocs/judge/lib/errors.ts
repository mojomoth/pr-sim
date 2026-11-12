// Isomorphic error kinds shared by the API and the UI.
export type JudgeErrorKind = "moderation" | "rate_limit" | "auth" | "timeout" | "bad_request" | "server" | "unknown";

export const JUDGE_ERROR_MESSAGE: Record<JudgeErrorKind, { title: string; hint: string }> = {
  moderation: { title: "안전 정책으로 이미지가 차단됐어요", hint: "같은 성향으로 다시 생성하면 다른 인물로 시도합니다." },
  rate_limit: { title: "요청이 몰려 잠시 쉬어야 해요", hint: "30초쯤 뒤에 다시 시도해 주세요." },
  auth: { title: "이미지 서비스 인증에 실패했어요", hint: "서버의 OPENAI_API_KEY 설정을 확인해 주세요." },
  timeout: { title: "생성 시간이 너무 오래 걸렸어요", hint: "화질을 낮추거나 다시 시도해 주세요." },
  bad_request: { title: "요청 형식이 올바르지 않아요", hint: "성향을 다시 선택해 주세요." },
  server: { title: "이미지 서비스에 일시적인 문제가 있어요", hint: "잠시 후 다시 시도해 주세요." },
  unknown: { title: "알 수 없는 오류가 발생했어요", hint: "다시 시도해 주세요." },
};

export const ERROR_STATUS: Record<JudgeErrorKind, number> = {
  moderation: 422,
  rate_limit: 429,
  auth: 502,
  timeout: 504,
  bad_request: 400,
  server: 502,
  unknown: 500,
};

export class JudgeGenError extends Error {
  constructor(
    public kind: JudgeErrorKind,
    message: string,
    public upstreamStatus?: number,
  ) {
    super(message);
    this.name = "JudgeGenError";
  }
}

export interface JudgeErrorBody {
  error: { kind: JudgeErrorKind; message: string; title: string; hint: string };
}
