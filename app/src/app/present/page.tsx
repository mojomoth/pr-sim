import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingScreen } from "./shared";
import { PresentScreen } from "./PresentScreen";

export const metadata: Metadata = { title: "발표 · PR·SIM" };

// /present?s=<session id> — client-rendered (session lives in IndexedDB).
export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <PresentScreen />
    </Suspense>
  );
}
