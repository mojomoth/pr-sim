import type { Metadata } from "next";
import { Landing } from "@/ui/screens/Landing";

export const metadata: Metadata = { title: "01 랜딩" };
export default function Page() {
  return <Landing />;
}
