"use client";
import { useEffect } from "react";
import { prefetchPanel } from "@/features/session/judgePrefetch";
import { latestDraft } from "./setup/draft";

/** Landing: start making the first judges' faces now when 시작하기 will open a draft that has none yet. */
export function PrefetchJudges() {
  useEffect(() => {
    latestDraft().then(
      (d) => !d?.judges.length && prefetchPanel(),
      () => {},
    );
  }, []);
  return null;
}
