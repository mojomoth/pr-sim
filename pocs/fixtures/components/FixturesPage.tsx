// Server component: browsable index of the shared test fixtures (HIL: open PDFs, play audio, read weak points).
import Link from "next/link";
import { FIXTURES, INTENDED_WEAK_POINTS, loadSampleSession } from "@/fixtures/lib";
import { TEMPERAMENT_LABEL } from "@/lib/types";

function mmss(t: number) {
  const s = Math.round(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function FixturesPage() {
  const session = await loadSampleSession();
  return (
    <main className="mx-auto w-full max-w-[880px] px-4 sm:px-6 py-8 flex flex-col gap-8 bg-canvas text-ink">
      <header className="flex items-center justify-between">
        <Link href="/" className="rounded-full bg-surface px-4 py-2 text-sm font-semibold">← 허브</Link>
        <span className="text-xs text-secondary tabular">pocs/fixtures</span>
      </header>
      <section>
        <p className="text-sm font-medium text-secondary">공용 테스트 데이터</p>
        <h1 className="mt-2 text-[32px] leading-[40px] font-bold tracking-[-1px]">친환경 패키징 사업 제안</h1>
        <p className="mt-2 text-secondary">(주)리웨이브 — 해조류 부산물 기반 생분해 완충재 &lsquo;웨이브셀&rsquo;의 Pre-A 20억 원 투자 피칭.</p>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[FIXTURES.presentationPdf, FIXTURES.proposalPdf].map((f) => (
          <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="rounded-[28px] bg-surface p-6 flex flex-col gap-2 hover:bg-card transition-colors">
            <span className="text-xs text-secondary tabular">{f.file}</span>
            <span className="text-xl font-semibold tracking-[-0.4px]">{f.desc}</span>
            <span className="mt-1 font-semibold">PDF 열기 →</span>
          </a>
        ))}
      </section>

      <a href={FIXTURES.script.url} target="_blank" rel="noreferrer" className="rounded-[24px] bg-surface p-5 flex items-center justify-between gap-4 hover:bg-card transition-colors">
        <span className="flex flex-col"><span className="font-semibold">발표 대본</span><span className="text-sm text-secondary">{FIXTURES.script.desc}</span></span>
        <span className="shrink-0 font-semibold">TXT 열기 →</span>
      </a>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">음성</h2>
        {[FIXTURES.speechWav, FIXTURES.answerWav].map((f) => (
          <div key={f.url} className="rounded-[24px] bg-surface p-5 flex flex-col gap-3">
            <div className="flex flex-col"><span className="font-semibold">{f.desc}</span><span className="text-xs text-secondary tabular">{f.file}</span></div>
            <audio controls preload="none" src={f.url} className="w-full" />
          </div>
        ))}
        <p className="text-sm text-secondary">16kHz 변형: <a className="underline" href={FIXTURES.speechWav16k.url}>speech-ko-16k.wav</a> · <a className="underline" href={FIXTURES.answerWav16k.url}>answer-ko-16k.wav</a> · 문장 타이밍 <a className="underline" href={FIXTURES.speechTiming.url}>timing.json</a> · 답변 정답 텍스트 <a className="underline" href={FIXTURES.answerText.url}>answer-ko.txt</a></p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">의도된 약점 (발표덱 vs 제안서)</h2>
        {INTENDED_WEAK_POINTS.map((w) => (
          <div key={w.id} className="rounded-[24px] border border-line p-5 flex flex-col gap-1">
            <span className="font-semibold">{w.title}</span>
            <span className="text-sm text-secondary">덱 · {w.deck}</span>
            <span className="text-sm text-secondary">제안서 · {w.proposal}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-semibold">샘플 세션</h2>
          <a className="text-sm font-semibold underline" href={FIXTURES.sampleSession.url}>JSON</a>
        </div>
        <p className="text-sm text-secondary">{session.situation}</p>
        <div className="flex flex-wrap gap-2">
          {session.judges.map((j) => (
            <span key={j.id} className="rounded-full bg-ink text-inverse px-4 py-2 text-sm font-semibold">{j.name} · {TEMPERAMENT_LABEL[j.temperament]}</span>
          ))}
          <span className="rounded-full bg-surface px-4 py-2 text-sm font-semibold tabular">발표 {session.presentationMinutes}분 · 질의 {session.qaMinutes}분</span>
        </div>
        <div className="rounded-[24px] bg-surface p-5 max-h-[320px] overflow-y-auto flex flex-col gap-2">
          {session.transcript.map((s, i) => (
            <p key={i} className="text-sm"><span className="text-secondary tabular mr-2">{mmss(s.t)}</span>{s.text}</p>
          ))}
        </div>
        {session.qa.map((q, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="self-start max-w-[90%] rounded-[20px] bg-card px-4 py-3 text-sm"><b>{q.judge.name}</b> <span className="text-secondary">({TEMPERAMENT_LABEL[q.judge.temperament]})</span><br />{q.question}</div>
            <div className="self-end max-w-[90%] rounded-[20px] bg-ink text-inverse px-4 py-3 text-sm">{q.answer}</div>
          </div>
        ))}
      </section>
    </main>
  );
}
