import type { Metadata } from "next";
import { HistoryScreen } from "./HistoryScreen";

export const metadata: Metadata = { title: "연습 기록 · DANSANG" };

export default function HistoryPage() {
  return <HistoryScreen />;
}
