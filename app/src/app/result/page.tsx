import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultScreen } from "./ResultScreen";

export const metadata: Metadata = { title: "결과 · PR·SIM" };

export default function ResultPage() {
  return (
    <Suspense fallback={null}>
      <ResultScreen />
    </Suspense>
  );
}
