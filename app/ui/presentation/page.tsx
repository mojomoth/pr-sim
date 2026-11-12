import type { Metadata } from "next";
import { Presentation } from "@/ui/screens/Presentation";

export const metadata: Metadata = { title: "03 발표" };
export default function Page() {
  return <Presentation />;
}
