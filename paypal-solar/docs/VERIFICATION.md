# Verification status — 2026-10-15

This record describes the local submission-readiness changes. It is not a claim that publication, a clean installation or the final video is complete.

| Check | Observed result |
|---|---|
| `npm run test:in-process` | 371 tests in 44 files passed. Includes four new archive/re-score/UI checks. Uses the explicitly separate TypeScript in-process runner. |
| `npx tsc --noEmit --incremental false` | Passed after archive and route changes. |
| `npm run lint` | Passed after archive and route changes. |
| Standard `npm test` | 2026-10-15, unrestricted local Windows terminal: 371 tests in 44 files passed. One pricing search test took over 5 s under full-suite load; its timeout is now 20 s. |
| CSS/PostCSS fix | Changed the application PostCSS plugins from a string array to an object mapping accepted by both Next.js and PostCSS configuration loaders. Standard component test now passes (see above). |
| Main evidence route | HTTP 200; archive/read-only banner present. |
| Holdout route | HTTP 200; Y11 present; empty-state message absent. |
| Source-only fresh copy | 2026-10-15: copied only tracked and committable files (no `runs/`), linked the existing installed dependencies (no `npm ci`), started `npm run dev:workbench`. `/`, `/coop?source=evidence` (€102.38, 10/10, archive banner), `/coop/exceptions?source=holdout` (12/12) and `/coop?source=rehearsal` returned 200. Rehearsal over HTTP: start, attach message, prepare, review succeeded; resolving an unreconciled bill was refused (409). A networked `npm ci` in the submission package passed on 2026-10-15 (729 packages, Node 22.16). |
| Production build | `npm run build` passed: compiled, type/lint checks, page generation and build traces completed. |
| Production HTTP | Archive and holdout routes returned 200; Y11 was present. A production workbench write returned 403. 2026-10-15, from the submission package after a fresh `npm ci`: `/`, `/coop`, evidence, holdout, rehearsal, `/energy`, `/demo`, `/demo/correction` returned 200. `/demo/evidence` returned 500 and `/demo` showed a raw file error without the BDEW H25 file; both now show the same fetch notice as `/energy`. The review packet `/api/settlement-review` printed the absolute server path of the missing file; it now names only `src/data/h25-june.json`. The empty AI agent and fixed-rule tabs of `/coop/exceptions` now say how to create those runs and point to the saved scores. After these fixes, 17 routes returned 200 (one API GET 404 by design) with no server path in any response. |
| Browser writes at 127.0.0.1 | 2026-10-15: in a real (headless Edge) browser opened at http://127.0.0.1:3017, every workbench write was refused with 403 "Cross-origin writes are disabled": the dev server reports request.url as localhost while the browser sends Origin 127.0.0.1. Fixed by comparing Origin with the Host header; route test added. After the fix, start rehearsal, attach message, prepare and review were completed by real clicks and typing. |
| Browser rendering | 2026-10-15: headless Edge screenshots of the evidence desk and the restyled exception desk inspected; no overlap or clipping seen. The rehearsal was completed by real clicks (row above). |
| Video | 2026-10-15: v8 MP4 rendered locally, 139.93 s, 1920x1080, 30 fps, with narration (local Kokoro TTS). Uses real app screenshots captured from a clean copy. Checked: no black frames, silences only at scene gaps, captions on one line. Not yet published. |

The default read-only archive is imported from tracked JSON. It does not depend on ignored runtime files or create payment drafts. The evidence manifest records the original file hash and the public redactions. Re-scoring archived model actions does not reproduce a new model call; displaying archived payment observations does not query PayPal.

No new model call, PayPal transaction, paid service, push, deployment or public upload was made during these changes.
