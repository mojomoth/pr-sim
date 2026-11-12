import type { Metadata } from "next";
import { Setup } from "@/ui/screens/Setup";

export const metadata: Metadata = { title: "02 상황 설정" };
export default function Page() {
  return <Setup />;
}
