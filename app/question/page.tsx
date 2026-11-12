import type { Metadata } from "next";
import { QuestionStudio } from "@/question/components/QuestionStudio";

export const metadata: Metadata = { title: "심사 질문 · PR·SIM PoC" };

export default function QuestionPage() {
  return <QuestionStudio />;
}
