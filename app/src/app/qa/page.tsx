import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingScreen } from "../present/shared";
import { QaScreen } from "./QaScreen";

export const metadata: Metadata = { title: "질의응답 · DANSANG" };

// /qa?s=<session id> — client-rendered (session lives in IndexedDB).
export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <QaScreen />
    </Suspense>
  );
}
