import Link from "next/link";
import { DevlogBoard } from "@/components/DevlogBoard";

export const metadata = { title: "DANSANG PoC · 개발 관측" };

export default function DevlogPage() {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <img src="/brand/symbol.svg" alt="" className="w-7 h-7" /> DANSANG <span className="text-secondary font-medium">PoC</span>
        </Link>
        <span className="text-sm text-secondary">멀티에이전트 개발 관측</span>
      </header>
      <div>
        <h1 className="text-[28px] leading-9 font-bold tracking-[-0.8px]">에이전트 개발 로그</h1>
        <p className="text-secondary mt-1">
          각 PoC 에이전트가 <code>scripts/devlog.mjs</code>로 남기는 이벤트(<code>devlog/events.jsonl</code>)를 실시간으로 보여 줍니다.
        </p>
      </div>
      <DevlogBoard />
    </main>
  );
}
