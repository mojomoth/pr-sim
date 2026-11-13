import type { Metadata } from "next";
import "@/ui/ui.css";

export const metadata: Metadata = {
  title: { default: "DANSANG — UI PoC", template: "%s · DANSANG UI" },
  description: "DESIGN.md 기반 DANSANG 7개 화면 프런트엔드 PoC (목업 데이터)",
};

export default function UiLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-canvas text-ink">{children}</div>;
}
