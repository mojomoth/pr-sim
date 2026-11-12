"use client";
// /slide/embed — two SlideViewers with default props (keyboard="focus"), as the real 발표 screen would embed them.
// Verifies keys only drive the focused viewer and never both at once.
import { useState } from "react";
import { SlideViewer } from "./SlideViewer";

export function EmbedDemo() {
  const [pages, setPages] = useState<Record<string, string>>({});
  const viewers = [
    { id: "a", title: "발표자료", src: "/api/slide/sample/presentation" },
    { id: "b", title: "제안자료", src: "/api/slide/sample/proposal" },
  ];
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-[var(--gutter)] pb-16 pt-6">
      <section>
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">임베드 확인</h1>
        <p className="mt-1 text-secondary">기본값(keyboard=&quot;focus&quot;)으로 뷰어 두 개를 넣었어요. 누른 뷰어만 ←/→ 키에 반응해요.</p>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {viewers.map((v) => (
          <section key={v.id} className="flex min-w-0 flex-col gap-2" data-embed={v.id}>
            <h2 className="text-[16px] font-semibold">
              {v.title} <span className="tabular text-secondary" data-embed-page={v.id}>{pages[v.id] ?? "–"}</span>
            </h2>
            <SlideViewer
              src={v.src}
              label={v.title}
              thumbnails={false}
              onPageChange={(p, total) => setPages((s) => ({ ...s, [v.id]: `${p} / ${total}` }))}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
