/** What the shared face notice needs from one judge row. */
export interface FaceRow {
  pending?: boolean;
  /** The judge has a stored photo (imageKey). Persisted, so it survives a reload. */
  hasFace: boolean;
  /** Error code of the last failure in this tab (lost on reload). */
  errorCode?: string;
}

/** Cause sentence when every failed face has the same, known code. */
const CAUSE: Record<string, string> = {
  rate_limited: "얼굴 사진 요청이 몰려서 지금은 사진을 만들 수 없어요.",
  timeout: "얼굴 사진을 만드는 데 시간이 너무 오래 걸렸어요.",
  store: "얼굴 사진을 이 기기에 저장하지 못했어요.",
  network: "네트워크 연결이 불안정해서 얼굴 사진을 만들지 못했어요.",
};
const CAUSE_DEFAULT = "얼굴 사진을 만드는 이미지 서비스를 지금 쓸 수 없어요.";

/**
 * One notice for the judge section when two or more judges have no photo, whatever the causes.
 * Derived from the saved judges (no photo = face missing), so it is still shown after a reload.
 */
export function faceNotice(rows: FaceRow[]): { message: string; count: number } | null {
  const failed = rows.filter((r) => !r.pending && !r.hasFace);
  const n = failed.length;
  if (n < 2) return null;
  const code = failed[0].errorCode;
  const cause = code && failed.every((r) => r.errorCode === code) ? (CAUSE[code] ?? CAUSE_DEFAULT) : null;
  const message = cause
    ? `${cause} 심사위원 ${n}명은 사진 대신 이름 첫 글자로 표시해요. 발표는 그대로 시작할 수 있어요.`
    : `심사위원 ${n}명의 얼굴 사진을 만들지 못했어요. 사진 대신 이름 첫 글자로 표시해요. 발표는 그대로 시작할 수 있어요.`;
  return { message, count: n };
}
