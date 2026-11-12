import type { Metadata } from "next";
import { Results } from "@/ui/screens/Results";

export const metadata: Metadata = { title: "05 종합 결과" };
export default function Page() {
  return <Results />;
}
