import type { Metadata } from "next";
import { History } from "@/ui/screens/History";

export const metadata: Metadata = { title: "07 목록" };
export default function Page() {
  return <History />;
}
