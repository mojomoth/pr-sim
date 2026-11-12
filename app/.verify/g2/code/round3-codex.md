What this change does: This app runs presentation practice with PDF slides, speech transcription, AI judges, and saved feedback. Sessions live in the browser; API routes call AI providers. I assumed a small deployed web app, including reloads and multiple tabs.

No P0 findings. No private environment key was reachable from client code: private-key readers have `server-only`; the client reads only `NEXT_PUBLIC_API_BASE`. TypeScript passes.

**Must fix:**

1. **P1 — Q&A resume loses the active answer and skips follow-ups** ([QaScreen.tsx:463](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:463))
   - **What this is:** Resume reconstructs the question queue from completed answers.
   - **Problem:** Leave halfway through an answer: its sentences remain in the transcript, but the answer is reset. Leave during a generated follow-up: resume selects only main/reserve questions and skips that follow-up.
   - **Fix:** Persist and restore the active question, original question, answer sentence IDs, and pending queue.
   - **If we skip it:** “Continue” repeats or skips questions and loses answer context.

2. **P1 — Failed answer saves do not stop progression** ([QaScreen.tsx:347](/Users/jyl/work/study/pr-sim/app/src/app/qa/QaScreen.tsx:347))
   - **What this is:** Answer recording updates the screen before saving to browser storage.
   - **Problem:** When storage is full, `record()` reports a notice but the caller advances anyway; phase-completion saves also swallow errors here and in `PresentScreen.tsx:128`.
   - **Fix:** Await successful answer and phase writes before advancing; retain failed data and offer retry.
   - **If we skip it:** Answers disappear after reload, or history resumes the wrong phase.

3. **P1 — Time-up navigation can outrun the final transcript** ([PresentScreen.tsx:132](/Users/jyl/work/study/pr-sim/app/src/app/present/PresentScreen.tsx:132))
   - **What this is:** Time-up opens a dialog with an immediately usable Q&A link.
   - **Problem:** `finish()` is still awaiting speech finalization. Clicking the link immediately unmounts the transcriber and lets Q&A read the session before the final words are saved.
   - **Fix:** Open the transition dialog only after transcription and session saves finish successfully.
   - **If we skip it:** Questions can be generated without the closing part of the presentation.

4. **P1 — The request-size limit runs after allocating the body** ([http/index.ts:133](/Users/jyl/work/study/pr-sim/app/src/server/http/index.ts:133))
   - **What this is:** Every JSON API uses this purported 4 MB limit.
   - **Problem:** A streamed request without `Content-Length` is fully buffered by `arrayBuffer()` before its size is checked.
   - **Fix:** Read chunks with a byte counter and cancel immediately when the total exceeds 4 MB.
   - **If we skip it:** Oversized requests can exhaust server memory before receiving a 413 response.

5. **P2 — Opening a result URL can finish an unfinished session** ([ResultScreen.tsx:61](/Users/jyl/work/study/pr-sim/app/src/app/result/ResultScreen.tsx:61))
   - **What this is:** The result screen automatically generates a report when any transcript exists.
   - **Problem:** Opening `/result?s=…` during presentation or Q&A passes `canReport`; successful generation sets status to `done` and clears resume information.
   - **Fix:** Require `status === "report"` for generation and redirect unfinished sessions to their current phase.
   - **If we skip it:** An early result visit removes the normal continuation path.

6. **P2 — Replaced uploads and judge photos remain in storage forever** ([SetupScreen.tsx:346](/Users/jyl/work/study/pr-sim/app/src/app/setup/SetupScreen.tsx:346))
   - **What this is:** Removing/replacing documents and judges drops their stored references.
   - **Problem:** Upload PDF A, replace it with B, then delete the session: deletion can find B only. Regenerating/removing judges similarly leaves their old image blobs behind.
   - **Fix:** Delete abandoned blobs after saving replacements, checking other sessions before deleting shared PDFs.
   - **If we skip it:** Repeated setup edits consume storage that deleting history cannot recover.

7. **P2 — Storage failures are falsely reported as deleted sessions** ([shared.tsx:26](/Users/jyl/work/study/pr-sim/app/src/app/present/shared.tsx:26))
   - **What this is:** Presentation and Q&A share this session-loading hook.
   - **Problem:** A blocked or unavailable browser database becomes `missing`, displaying “deleted or created on another device” instead of the actual storage error.
   - **Fix:** Add a distinct failed state with the storage message and a retry action.
   - **If we skip it:** Users are steered toward starting over even when their session still exists.

**Should fix:**

8. **P2 — Unused exports add maintenance work** ([Icons.tsx:26](/Users/jyl/work/study/pr-sim/app/src/components/Icons.tsx:26), [store.ts:25](/Users/jyl/work/study/pr-sim/app/src/server/wiki/store.ts:25))
   - **What this is:** `ChevronRight`, `Expand`, `User`, and `readRawPage` are exported helpers.
   - **Problem:** None has a caller in `src/` or the inspected verification scripts.
   - **Fix:** Delete these four unused exports.
   - **If we skip it:** Unused UI and server code remain part of the maintenance surface.

Verdict: fix 1–7 first.  
Lean: -16 lines possible.  
Not checked: fresh browser/API execution, production bundle contents, and deployment-level request limits; this was a source review with a passing TypeScript check.