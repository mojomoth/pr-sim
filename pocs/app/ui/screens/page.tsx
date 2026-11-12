import type { Metadata } from "next";
import { ScreensIndex } from "@/ui/screens/ScreensIndex";

export const metadata: Metadata = { title: "화면 목록" };
export default function Page() {
  return <ScreensIndex />;
}
