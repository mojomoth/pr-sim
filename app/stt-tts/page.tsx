import type { Metadata } from "next";
import { SttTtsPage } from "@/stt-tts/components/SttTtsPage";

export const metadata: Metadata = { title: "STT / TTS · PR·SIM PoC" };

export default function Page() {
  return <SttTtsPage />;
}
