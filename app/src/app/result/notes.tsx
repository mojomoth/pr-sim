import type { Report } from "@/features/session/types";

/** Lite fallback models judged at least one section → scores can run high. */
function liteModels(report: Report): string[] {
  const used = Object.keys(report.meta.usage.byModel ?? {});
  const lite = used.filter((k) => /lite/i.test(k)).map((k) => k.replace(/^\w+:/, ""));
  if (lite.length) return [...new Set(lite)];
  return /lite/i.test(report.meta.provider) ? [...new Set(report.meta.provider.match(/[\w.-]*lite[\w.-]*/gi) ?? [])] : [];
}

export function LiteNotice({ report }: { report: Report }) {
  const lite = liteModels(report);
  if (!lite.length) return null;
  return (
    <p className="rounded-[16px] border border-ink px-4 py-3 text-[14px] leading-[21px]">
      <span className="font-semibold">경량 모델이 채점한 결과예요.</span> 주력 모델을 쓸 수 없어서 {lite.join(", ")}(으)로 평가했어요. 점수가 실제보다 후하게 나올 수 있으니
      참고용으로 봐 주세요.
    </p>
  );
}

/** Which model actually produced the report (after any fallback). */
export function ProviderNote({ report }: { report: Report }) {
  const m = report.meta;
  return (
    <p className="text-center text-[12px] leading-[18px] text-secondary">
      평가 모델 {m.provider} · {new Date(m.createdAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
    </p>
  );
}
