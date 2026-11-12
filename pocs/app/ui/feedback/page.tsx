import type { Metadata } from "next";
import { Feedback } from "@/ui/screens/Feedback";

export const metadata: Metadata = { title: "06 상세 피드백" };
export default function Page() {
  return <Feedback />;
}
