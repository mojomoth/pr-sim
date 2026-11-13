import type { Metadata } from "next";
import { SttTtsPage } from "@/stt-tts/components/SttTtsPage";

export const metadata: Metadata = { title: "STT / TTS · DANSANG PoC" };

export default function Page() {
  return <SttTtsPage />;
}
