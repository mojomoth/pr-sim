import type { Metadata } from "next";
import { WikiStudio } from "@/wiki/components/WikiStudio";

export const metadata: Metadata = { title: "Context to Wiki · PR·SIM PoC" };

export default function WikiPage() {
  return <WikiStudio />;
}
