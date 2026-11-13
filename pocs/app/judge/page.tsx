import type { Metadata } from "next";
import { JudgeStudio } from "@/judge/components/JudgeStudio";

export const metadata: Metadata = { title: "심사위원 생성 · DANSANG PoC" };

export default function JudgePage() {
  return <JudgeStudio />;
}
