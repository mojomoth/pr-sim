# PR-SIM app

Presentation rehearsal simulator: upload a deck (and an optional proposal), present to three AI judges with a live
transcript, answer their spoken questions, then read an evidence-linked report. Next.js 16 (App Router), React 19,
Tailwind v4, pnpm. Design, decisions and the API contract live in `../docs/` (start with
`../docs/dev-harness/v1/run.md` and `../docs/wiki/api-contract.md`).

## Run

```bash
pnpm install
pnpm dev            # http://localhost:3000 — needs ../.env (symlinked as .env.local) with the provider keys
pnpm build
```

Keys are read only by the Route Handlers in `src/app/api/**`; nothing is stored on the server (sessions, PDFs and
reports live in the browser's IndexedDB).

## Layout

- `src/app/` — screens (`/`, `/setup`, `/present`, `/qa`, `/result`, `/history`) and the 7 API routes
- `src/components/` — shared UI
- `src/features/` — client logic (session store + API client, STT, slides/pdf.js)
- `src/platform/` — camera, mic, storage, audio behind one interface (web now, native later)
- `src/server/` — server-only code behind the routes (judges, wiki, questions, TTS, report)
- `public/pdfjs/` — pdf.js runtime, refreshed with `pnpm sync:pdfjs` after upgrading `pdfjs-dist`

## Tests

- `pnpm test` — unit tests (node:test, no extra deps): sentence splitting, PDF checks, request schemas, speech metrics, timers.
- `pnpm test:api` — smoke test against a running server (`BASE_URL`, default `http://localhost:3000`): 400/403/413/422 paths and the STT token route.
- `pnpm test:e2e` — full browser flow with the real APIs (~10 min, uses provider quota). Needs the server running, Chrome, and `../pocs` installed (puppeteer-core, fake mic audio in `../pocs/fixtures/audio`). Output in `.verify/e2e/<timestamp>/`.
  Env: `CHROME_PATH`, `E2E_OUT`, `E2E_AUDIO`.
- Against the deployment: `BASE_URL=https://pr-sim-lake.vercel.app pnpm test:api` (or `test:e2e`).

Checks before a deploy: `pnpm test && pnpm lint && pnpm build`, then `pnpm test:api` and `pnpm test:e2e` against `pnpm dev`.

## Deploy (Vercel)

Production: https://pr-sim-lake.vercel.app (project `pr-sim`, region `icn1`, fluid compute; see `vercel.json`).
Deploys go through the CLI from this folder; Git auto-deploy is disconnected.

```bash
vercel deploy --prod --cwd app      # from the repo root; .vercelignore keeps .env*, .verify/, tests/ out of the upload
```

- Env vars (Production + Preview, type sensitive): `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_API_KEY`. Do not upload other keys from `.env`.
- Optional: `ALLOWED_ORIGINS` (comma list, e.g. `capacitor://localhost`) lets a native shell call the API; unset means same-origin only.
  `REPORT_LLM_PROVIDER`, `WIKI_LLM_PROVIDER`, `REPORT_GEMINI_MODELS` narrow the provider chains.
- `vercel link` appends `VERCEL_OIDC_TOKEN` to `.env.local` (a symlink to the root `.env`); remove those lines afterwards.
- Limits the code relies on: request body 4.5MB (the app rejects > 4MB with JSON 413), `maxDuration` ≤ 300 s, read-only filesystem.
  Measurements and open issues: `../docs/dev-v1/report.md` sections 5–7.
