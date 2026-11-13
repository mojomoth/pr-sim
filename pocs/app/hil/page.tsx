import type { Metadata } from "next";
import { HilChecklist } from "@/hil/components/HilChecklist";

export const metadata: Metadata = {
  title: "HIL 검증 체크리스트 · DANSANG PoC",
  description: "DANSANG PoC별 사람 검증 체크리스트, 남은 이슈와 결정이 필요한 사항",
};

export default function HilPage() {
  return <HilChecklist />;
}
