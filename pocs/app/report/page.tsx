import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportStudio } from "@/report/components/ReportStudio";

export const metadata: Metadata = { title: "리포트 생성 · DANSANG PoC" };

export default function ReportPage() {
  return (
    <Suspense>
      <ReportStudio />
    </Suspense>
  );
}
