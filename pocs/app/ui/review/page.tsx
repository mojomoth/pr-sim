import type { Metadata } from "next";
import { Review } from "@/ui/screens/Review";

export const metadata: Metadata = { title: "04 심사" };
export default function Page() {
  return <Review />;
}
