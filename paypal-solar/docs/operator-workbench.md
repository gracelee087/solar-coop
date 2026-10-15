# Operator workbench

The operator can now follow one statement from its computed settlement through human approval, saved provider
reconciliation and a customer investigation. `/` opens `/coop`; the earlier energy overview is at `/energy`.
The separate synthetic exception evaluation remains at `/coop/exceptions` and is not mixed into the monthly ledger.

## Run locally

```sh
npm ci
npm run dev:workbench
```

Open `http://127.0.0.1:3007/coop`. Use **Start offline June rehearsal**. It computes the ten drafts from the modelled
June CSV with the existing scripted model. It does not need keys and makes no external call. Repeating setup keeps
existing rehearsal decisions. The custom Next development server binds only to 127.0.0.1; PORT overrides 3007.
The standard `npm run dev` still works in an ordinary local environment.

1. Select a consumer statement, enter an operator name, choose what the customer disputes (bill amount, metered
   energy, already paid) and attach a fictional customer message.
2. Read the bill check: meter file → allocation (shared energy and residual supply) → billed kWh, price and amount →
   the statement's PayPal record. Each link is MATCH, MISMATCH, NOT COMPARABLE or OPEN.
3. Prepare an offline investigation. The fixed checklist and reply template are explicitly labelled **not AI**.
   Expand an evidence tag to see the linked fact, manual entry or unverified message.
4. Record what will be checked next (**investigating**). Add evidence received from a metering operator, grid
   operator or customer as a manual entry; it invalidates the investigation until it is prepared and reviewed again.
5. Record the outcome:
   - amount or meter dispute: **explanation sent** only when the bill check matches, then **customer confirmed** or
     **closed after operator review** (no customer confirmation);
   - payment claim: **closed** only after the statement is executed and reconciled;
   - **waiting for an external answer** and **correction needed** keep the case open.
   The dispute status and the payment status are separate: a closed dispute does not mean the bill is paid.

Approving a payment uses the existing approval API; execution and PayPal reconciliation remain separate CLI operations.
Reviewing a case does not pause reminders, send messages, change payment status, or verify bank transfers.
The bank connection is absent. Bank-only payments remain unresolved in this prototype until a separate accounting
workflow is implemented; there is intentionally no “customer says paid → mark paid” shortcut.

## Actual model path (optional, not run for this change)

```sh
npm run coop:investigate -- 2026-06 bill-ST-202606-H07 --rehearsal
```

Default is a dry run: reports the selected model, evidence IDs and input character count, with zero calls.
Only an explicit `--live` plus `GOOGLE_GENERATIVE_AI_API_KEY` calls Gemini. `COOP_AGENT_MODEL` selects the model.
The model has exactly two tools: read the linked statement and propose an investigation. It must read first, cite
the bill check (C3) for an amount or meter dispute, or the saved provider and bank limitations (F4, F5) for a payment
claim, cite every message, and supply unresolved claims, checks and an unsent reply.
No model tool can approve, execute, refund, send, resolve a case, or mark paid. On failure the case stays open.
Existing evidence IDs and required fields are checked; semantic correctness is **not** guaranteed.
The proposal is saved only if the statement and its messages did not change during the run and the case is still open.
An offline template may replace an AI proposal only through an explicit prepare action; the source label changes.

## Storage and concurrency

- Existing payment states remain in `runs/coop`, `runs/coop-replay`, and `runs/coop-rehearsal`.
- Case records live in `runs/coop-workbench/<source>-<period>.json`, keyed by the exact ledger draft ID.
- Sources, periods, draft identity and amount are never inferred from customer text.
- Operations use the existing monthly state lock. Reads, version checks and atomic sidecar writes happen under it.
- Browser requests carry a SHA-256 version over the current draft, settlement view and case. Stale writes fail.
- New evidence invalidates the investigation. A review alone cannot satisfy month-end readiness.
- Each run saves the SHA-256 of its meter file and its contract terms (`inputs`). The bill check compares only
  against the same versions; runs saved before this (including the archived evidence) show as not comparable.
- Readiness requires every displayed payment to be executed and matched, no unresolved cases, no run problems,
  and no extra ledger entries or orphaned cases requiring review. This is payment-record readiness, not a complete
  tax/accounting close or a guarantee of bank reconciliation.
- Names are local audit labels, not authentication. Production writes are disabled unless the existing
  `ALLOW_COOP_DESK_DECISIONS` override is explicitly configured for an otherwise protected deployment.
- No new package dependency, no copied secret, no PayPal execution path was added. System fonts avoid a Google font download.

## Verification

The original test launcher depends on an esbuild child process. In the restricted Windows environment it fails
with `spawn EPERM`. `npm run test:in-process` runs the same Vitest suite using TypeScript's in-process compiler,
native config loading and worker threads. It preserves symlinks, skips CSS processing for component-markup tests,
and removes Vitest's redundant NODE_ENV identity define (without changing the environment value).

Full suite: **367 passing tests, 43 files** at implementation time. Added tests cover claim/payment separation,
stale messages and payment facts, source isolation, invented evidence, model tool permissions, first-run setup,
read-only production and case closure only after reconciliation. Mocked model tests demonstrate the code boundary,
not model intelligence or prompt-injection resistance in a real model. TypeScript and ESLint are also required.

Live local HTTP checks exercise the real Next page and API, including persisted preparation and review. No PayPal
or model call was made. Browser rendering/click inspection remains outstanding because both available UI automation
entry points were unavailable. Server-rendered HTML and React markup tests are not a substitute for visual checks.

## Next evidence to collect before submission

Use the actual workbench, not a video-only reconstruction, for the main demo. Keep the pending bank claim unresolved
unless genuine matching provider evidence has been obtained. Label synthetic customer messages and saved sandbox
records separately. Show preparation → operator review → saved result, with no implication that a template is AI.

For a small usability study, recruit relevant operators or people experienced with reconciliation; do not call a
developer rehearsal an independent user study. Use the same fictional month for each participant:

| Task | Observable result |
| --- | --- |
| Explain a bill and its approval state | Correct amount, source and next step without assistance |
| Investigate a transfer claimed under another name | Distinguishes customer claim from provider evidence; identifies checks |
| Decide whether the month is ready | Finds unreconciled payments and unresolved cases |

Record participant role, task order, elapsed time, missed issues, assistance and exact feedback with permission.
If comparing with a manual workflow, use equivalent cases and alternate order; report sample size and study limitations.
No user study, independent model evaluation, time-saving measurement or pricing validation has yet been completed.
