What this change does: This app runs presentation practice from PDF setup through speech transcription, AI questions, and feedback, with sessions stored in the browser. I reviewed `src/` assuming the planned public Vercel deployment and users who reload, leave, and resume sessions.

TypeScript and ESLint pass. No server environment key is reachable through the inspected client imports: secret-reading modules have `server-only`; `NEXT_PUBLIC_API_BASE` is intentionally public.

**Must fix:**

1. **P1 — Anyone can spend the server’s AI quota** ([src/server/http/index.ts:116](/Users/jyl/work/study/pr-sim/app/src/server/http/index.ts:116)).
   - **What this is:** Every paid API route uses this guard.
   - **Problem:** Requests without browser metadata pass most routes; a non-browser caller can forge `sec-fetch-site: same-origin` for token issuance. There is no authenticated access check.
   - **Fix:** Require authenticated access in `guard()` before issuing tokens or calling providers.
   - **If we skip it:** Public deployment exposes paid generation and transcription to unauthorized callers.

2. **P1 — Microphone startup can outlive Stop or navigation** ([src/features/stt/useSentenceTranscriber.ts:331](/Users/jyl/work/study/pr-sim/app/src/features/stt/useSentenceTranscriber.ts:331)).
   - **What this is:** Startup waits for microphone permission and then connects transcription.
   - **Problem:** Stop/unmount can run while permission is pending; when permission resolves, startup still stores the microphone and opens a socket. Cleanup has already run.
   - **Fix:** Invalidate each startup on stop/unmount and immediately close resources returned by stale asynchronous calls.
   - **If we skip it:** The microphone or connection can remain active after the user leaves.

3. **P1 — Leaving Q&A can start recording again** ([src/app/qa/QaScreen.tsx:278](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:278)).
   - **What this is:** Speech completion calls `listen()`, which starts transcription.
   - **Problem:** Browser Back unmounts Q&A without setting `ended`, invalidating speech, or aborting judging. Pending speech can finish afterward and call `listen()` on the abandoned screen.
   - **Fix:** Add unmount cleanup that marks the engine ended, invalidates speech, stops playback, and aborts pending requests.
   - **If we skip it:** Old sessions can keep speaking, recording, or writing after navigation.

4. **P1 — Resume loses the current answer and pending follow-up** ([src/app/qa/QaScreen.tsx:477](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:477)).
   - **What this is:** Exit saves time and an already-submitted answer.
   - **Problem:** Exiting while answering saves sentences but no current-question association. Resume rebuilds only the main/reserve queue, so it repeats an unfinished main question or skips an unanswered follow-up.
   - **Fix:** Persist and restore the current question, original question, and collected answer sentence IDs alongside remaining time.
   - **If we skip it:** Earlier words disappear from the answer being graded, and follow-ups vanish.

5. **P1 — Failed saves still advance the session** ([src/app/present/PresentScreen.tsx:128](/Users/jyl/work/study/pr-sim/app/src/app/present/PresentScreen.tsx:128), [src/app/qa/QaScreen.tsx:351](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:351)).
   - **What this is:** Phase endings save the next status before showing the next screen.
   - **Problem:** Both swallow storage failures and proceed; Q&A also swallows transcript-save failures. With full or unavailable storage, displayed progress differs from the saved session.
   - **Fix:** Await required writes, surface failures, and offer retry before enabling the next phase.
   - **If we skip it:** Answers can be lost and history can resume an earlier phase.

6. **P2 — A session without recognized speech reaches a dead end** ([src/app/result/ResultScreen.tsx:61](/Users/jyl/work/study/pr-sim/app/src/app/result/ResultScreen.tsx:61)).
   - **What this is:** Results require at least one transcript sentence or Q&A entry.
   - **Problem:** If transcription fails and time expires before an answer is recorded, Q&A saves `status: "report"`, but results refuse generation. History’s Resume returns to that same refusal.
   - **Fix:** Give this state a restart/recovery action that resets the session to a usable phase.
   - **If we skip it:** The unfinished session cannot continue through Resume.

7. **P2 — Opening results can prematurely finish an active session** ([src/app/result/ResultScreen.tsx:128](/Users/jyl/work/study/pr-sim/app/src/app/result/ResultScreen.tsx:128)).
   - **What this is:** Loading a reportless session automatically starts report generation.
   - **Problem:** `canReport` ignores session status. Opening `/result?s=<active-id>` after one sentence generates partial feedback and writes `status: "done"`.
   - **Fix:** Generate reports only for sessions in `report` status; redirect active sessions to their current phase.
   - **If we skip it:** A direct link can close unfinished practice and preserve incomplete feedback.

8. **P2 — Replaced uploads and judge images leak browser storage** ([src/app/setup/SetupScreen.tsx:304](/Users/jyl/work/study/pr-sim/app/src/app/setup/SetupScreen.tsx:304), [src/app/setup/SetupScreen.tsx:346](/Users/jyl/work/study/pr-sim/app/src/app/setup/SetupScreen.tsx:346)).
   - **What this is:** Setup removes or replaces references to stored PDFs and judge pictures.
   - **Problem:** Old blobs are never deleted. Session deletion only sees current references, so repeatedly replacing a 30 MB PDF leaves permanently unreachable files.
   - **Fix:** Delete superseded judge blobs and PDFs no remaining session references after successfully saving replacements/removals.
   - **If we skip it:** Storage fills up even when users delete their visible sessions.

9. **P2 — Long spoken answers cannot be judged** ([src/app/qa/QaScreen.tsx:622](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:622), [src/server/question/schema.ts:110](/Users/jyl/work/study/pr-sim/app/src/server/question/schema.ts:110)).
   - **What this is:** The screen joins every answer sentence and sends the full text.
   - **Problem:** An answer over 4,000 characters is accepted locally but rejected by the follow-up API; retry sends the same invalid body.
   - **Fix:** Align the API’s answer/thread limits with supported session lengths and enforce the same limit visibly in the client.
   - **If we skip it:** Longer answers repeatedly fail grading despite successful transcription.

10. **P2 — Storage errors are reported as deleted sessions** ([src/app/present/shared.tsx:26](/Users/jyl/work/study/pr-sim/app/src/app/present/shared.tsx:26)).
    - **What this is:** Presentation and Q&A share a session loader.
    - **Problem:** Every database exception becomes `missing`, so a blocked or failed read tells users their record is absent and provides no load retry.
    - **Fix:** Add a separate failed state with the storage error and a retry action.
    - **If we skip it:** Recoverable failures appear to be lost records.

**Should fix:**

11. **P2 — Five exported helpers/components have no callers** ([src/features/slide/pdf.ts:138](/Users/jyl/work/study/pr-sim/app/src/features/slide/pdf.ts:138), [src/server/wiki/store.ts:25](/Users/jyl/work/study/pr-sim/app/src/server/wiki/store.ts:25), [src/components/Icons.tsx:26](/Users/jyl/work/study/pr-sim/app/src/components/Icons.tsx:26)).
    - **What this is:** `validatePdf`, `readRawPage`, `ChevronRight`, `Expand`, and `User` are exported utilities.
    - **Problem:** None has a reference elsewhere in `src/`; uploads already validate through `readPdf`.
    - **Fix:** Delete these five unused exports and the obsolete `validatePdf` documentation.
    - **If we skip it:** Unused alternatives remain available to confuse later changes.

Verdict: fix 1–10 first.  
Lean: -26 lines possible.  
Not checked: Live browser reproduction, provider calls, deployment access controls, and production build; this review used source tracing plus passing type and lint checks.