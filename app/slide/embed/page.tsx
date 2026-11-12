import type { Metadata } from "next";
import { EmbedDemo } from "@/slide/components/EmbedDemo";

export const metadata: Metadata = { title: "Slide View 임베드 · PR·SIM PoC" };

export default function Page() {
  return <EmbedDemo />;
}
