import Link from "next/link";
import { POCS } from "@/lib/pocs";
import { DevlogBoard } from "@/components/DevlogBoard";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 py-8 flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-lg">
          <img src="/brand/symbol.svg" alt="" className="w-7 h-7" /> PR·SIM <span className="text-secondary font-medium">PoC</span>
        </div>
        <Link href="/devlog" className="rounded-full bg-surface px-4 py-2 text-sm font-semibold">개발 관측 →</Link>
      </header>
      <section>
        <p className="text-sm font-medium text-secondary">Proof of Concept · Human in the Loop</p>
        <h1 className="mt-2 text-[40px] leading-[48px] font-bold tracking-[-1.6px]">기능 검증 허브</h1>
        <p className="mt-2 text-secondary">각 카드를 열어 직접 확인하고 피드백을 남겨 주세요. 검증 체크리스트는 <Link className="underline" href="/hil">/hil</Link>.</p>
      </section>
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {POCS.filter((p) => p.path).map((p) => (
          <Link key={p.key} href={p.path!} className="group rounded-[28px] bg-surface p-6 flex flex-col gap-2 hover:bg-card transition-colors">
            <span className="text-xs text-secondary tabular">pocs/{p.key}</span>
            <span className="text-xl font-semibold tracking-[-0.4px]">{p.title}</span>
            <span className="text-secondary">{p.desc}</span>
            <span className="mt-2 font-semibold">{p.path} →</span>
          </Link>
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">진행 상태</h2>
        <DevlogBoard compact />
      </section>
    </main>
  );
}
