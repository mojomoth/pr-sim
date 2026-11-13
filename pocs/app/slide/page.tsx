import type { Metadata } from "next";
import { SlidePage } from "@/slide/components/SlidePage";

export const metadata: Metadata = { title: "Slide View · DANSANG PoC" };

export default function Page() {
  return <SlidePage />;
}
