import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupScreen } from "./SetupScreen";

export const metadata: Metadata = { title: "상황 설정 · PR·SIM" };

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <SetupScreen />
    </Suspense>
  );
}
