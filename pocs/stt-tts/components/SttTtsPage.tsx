import Link from "next/link";
import { SttPanel } from "./SttPanel";
import { TtsPanel } from "./TtsPanel";

export function SttTtsPage() {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-[var(--gutter)] pb-12 flex flex-col gap-6">
      <header className="h-14 grid grid-cols-[44px_1fr_auto] items-center">
        <Link href="/" aria-label="PoC 허브로" className="w-11 h-11 grid place-items-center -ml-2 rounded-full">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Link>
        <span className="text-center font-semibold">STT / TTS</span>
        <Link href="/devlog" className="rounded-full bg-surface px-3 py-2 text-sm font-semibold">개발 관측</Link>
      </header>
      <div>
        <p className="text-sm font-medium text-secondary">pocs/stt-tts · Gemini</p>
        <h1 className="mt-1 text-[28px] leading-9 font-bold tracking-[-0.8px]">문장 단위 전사와 페르소나 음성</h1>
        <p className="mt-2 text-secondary">발표 음성을 문장별 말풍선으로 받아 적고, 심사위원 페르소나(성별·연령·성향)에 맞는 목소리로 질문을 읽습니다.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <SttPanel />
        <TtsPanel />
      </div>
    </main>
  );
}
