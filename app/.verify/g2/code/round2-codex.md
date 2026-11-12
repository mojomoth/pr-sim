What this change does: This app runs a presentation rehearsal with PDF slides, live transcription, AI questions, and a final report. Sessions stay in browser storage; API routes call AI providers. I assumed the documented Vercel deployment and ordinary repeat use, including leaving and resuming sessions.

TypeScript and ESLint pass. I found no private `process.env` key reachable from client code: secret-bearing modules import `server-only`; the client uses only `NEXT_PUBLIC_API_BASE`. The temporary serverless rate-limit limitation is already documented.

**Must fix:**

1. **P1 — A small report request can exhaust server memory** ([src/server/report/metrics.ts:146](/Users/jyl/work/study/pr-sim/app/src/server/report/metrics.ts:146))
   - **What this is:** Report generation creates one timeline entry for every minute between transcript timestamps.
   - **Problem:** The API accepts timestamps without an upper bound. Two sentences at `0` and `6,000,000,000` seconds request **100,000,001 objects**; schema acceptance and a smaller allocation were reproduced locally.
   - **Fix:** Bound transcript timestamps to supported session lengths and cap timeline allocation.
   - **If we skip it:** One request can exhaust memory or block a server instance.

2. **P1 — Failed saves still let the session finish** ([src/app/qa/QaScreen.tsx:347](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:347), [src/app/present/PresentScreen.tsx:128](/Users/jyl/work/study/pr-sim/app/src/app/present/PresentScreen.tsx:128))
   - **What this is:** Answers, transcripts, and phase changes are saved to browser storage.
   - **Problem:** Q&A advances before answer saves succeed, transcript failures are swallowed, and both phase-ending paths swallow status-save errors. A storage failure can therefore produce a report missing answers or leave history pointing at the previous phase.
   - **Fix:** Await required saves, retain unsaved data, and offer retry before advancing or navigating.
   - **If we skip it:** Users lose completed work despite seeing the session advance.

3. **P2 — Resume loses the active answer and skips pending follow-ups** ([src/app/qa/QaScreen.tsx:463](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:463))
   - **What this is:** Resume reconstructs the queue from completed answers and the main/reserve question lists.
   - **Problem:** Leaving while answering preserves transcript sentences but not their association with the active question. Leaving during a follow-up skips it on resume because its parent is already answered and follow-ups are absent from both queues.
   - **Fix:** Persist and restore the active question, its answer sentence IDs, and any pending follow-up.
   - **If we skip it:** Users repeat answers or silently miss questions.

4. **P2 — Confirmation dialogs pause the clock but keep recording** ([src/app/present/PresentScreen.tsx:81](/Users/jyl/work/study/pr-sim/app/src/app/present/PresentScreen.tsx:81), [src/app/qa/QaScreen.tsx:130](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:130))
   - **What this is:** Opening an exit/back confirmation pauses the countdown.
   - **Problem:** Transcription continues using elapsed wall-clock time. Speaking with the dialog open gives extra answer time; after restarting the microphone, timestamps can move backward relative to earlier sentences.
   - **Fix:** Keep the countdown running while recording, or pause recording and its timestamp clock together.
   - **If we skip it:** Practice duration and report timing become incorrect.

5. **P2 — Long spoken answers cannot be submitted successfully** ([src/server/question/schema.ts:110](/Users/jyl/work/study/pr-sim/app/src/server/question/schema.ts:110))
   - **What this is:** Follow-up requests limit each answer to 4,000 characters.
   - **Problem:** The UI allows uninterrupted answers throughout a 15-minute Q&A and sends the entire answer. An answer exceeding 4,000 characters always receives HTTP 400; retry sends the same rejected content.
   - **Fix:** Bound the text sent for assessment, including thread answers, while preserving the complete answer locally.
   - **If we skip it:** Long answers cannot receive assessment or follow-up questions.

6. **P2 — Replacing files and judges permanently leaks stored blobs** ([src/app/setup/SetupScreen.tsx:333](/Users/jyl/work/study/pr-sim/app/src/app/setup/SetupScreen.tsx:333))
   - **What this is:** Uploads and generated judge images are stored separately from session records.
   - **Problem:** Replacing/removing a PDF or judge drops its reference without deleting its blobs. Later session deletion only sees current references, so repeated replacements leave files that the UI cannot remove.
   - **Fix:** After replacement/removal succeeds, delete superseded blobs that no other session references.
   - **If we skip it:** Browser storage grows until future uploads or session saves fail.

7. **P2 — Opening results can prematurely complete an active session** ([src/app/result/ResultScreen.tsx:61](/Users/jyl/work/study/pr-sim/app/src/app/result/ResultScreen.tsx:61))
   - **What this is:** The results page automatically generates a report when documents and any transcript or answer exist.
   - **Problem:** It does not require the session to be in the report phase. Opening `/result?s=<active-id>` during presentation generates a partial report and writes `status: "done"`, removing normal resume access.
   - **Fix:** Generate reports only for sessions in `report` status; redirect active sessions to their current phase.
   - **If we skip it:** A results deep link can end an unfinished rehearsal.

8. **P2 — Duplicate validation schemas disagree about valid session data** ([src/server/report/schema.ts:17](/Users/jyl/work/study/pr-sim/app/src/server/report/schema.ts:17))
   - **What this is:** Questions and reports define separate validators for the same lint findings.
   - **Problem:** The question schema accepts a 4,001-character lint message, but the report schema rejects it above 4,000 characters. `reportInput()` forwards these findings unchanged, so valid question data can make every report attempt fail.
   - **Fix:** Reuse one bounded `LintIssueIn` schema for question and report requests.
   - **If we skip it:** Some saved sessions cannot produce reports, even after retrying.

9. **P2 — Storage errors are falsely shown as deleted sessions** ([src/app/present/shared.tsx:26](/Users/jyl/work/study/pr-sim/app/src/app/present/shared.tsx:26))
   - **What this is:** Presentation and Q&A share a session-loading hook.
   - **Problem:** Every storage exception becomes `missing`. A temporary database failure therefore tells users their record was deleted or belongs to another device, with no loading retry.
   - **Fix:** Add a failed-load state with the storage error and retry action, as the results page already does.
   - **If we skip it:** Recoverable failures look like lost records.

**Should fix:**

10. **P2 — Unused helpers and icons add maintenance work** ([src/server/wiki/store.ts:25](/Users/jyl/work/study/pr-sim/app/src/server/wiki/store.ts:25), [src/components/Icons.tsx:26](/Users/jyl/work/study/pr-sim/app/src/components/Icons.tsx:26))
    - **What this is:** `readRawPage`, `ChevronRight`, `Expand`, and `User` are exported helpers/components.
    - **Problem:** Searches found no callers in `src/` or the inspected verification scripts.
    - **Fix:** Delete these four unused exports.
    - **If we skip it:** Unused code remains part of future maintenance and review.

Verdict: fix 1–9 first.  
Lean: -16 lines possible.  
Not checked: Live browser/media flows, paid-provider calls, and deployment behavior; findings are based on source tracing, passing static checks, and the local timestamp reproduction.