# Monthly settlement verification

The target is no operator intervention for valid monthly bills. This is not a claim that customers are automatically
debited, that a live month has been processed, or that AI outperforms a deterministic workflow.

## Trusted boundary

- Server code validates the complete June series and saved agreements before any model or payment calls.
- Only household IDs are tool inputs. Calculations and recipients stay in a cloned server-side plan.
- Earlier invoices under different terms block new billing. They are not relabelled as payment of the saved agreement.
- Repeated calls to the same tool within a run share one operation; different tools for a household execute in order.
  Cancellation is checked before queued work and after external responses. Late responses cannot mark a stopped run paid.
  The agent deadline also aborts the billing tool; a stopped month remains unfinished.
  Across runs, the existing billing agent uses fixed invoice
  numbers, PayPal lookup and request IDs. A creation timeout becomes a review case, never an automatic retry with a new number.
- A model may request completion, but code refuses it while invoices still need processing. Final free text is not evidence.
- PAID requires invoice identity/amount checks plus matching paid total and zero due. Pending, manual payment entries,
  refunds, cancelled invoices and mismatches are distinct from verified payment.
- The CLI persists and flushes an intent event before calling the billing tool. Failed audit writes block issuing.

## Repeatable checks without external calls

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run settlement:preview
npm run settlement:rehearsal
```

The new tests cover valid and malformed meter data, missing/swapped agreements, nonfinite price windows, zero energy,
historical invoice conflicts, amount/recipient/number/ID mismatches, paid/due evidence, pending and manual-payment
statuses, duplicate and concurrent tool calls, interruption, persistence failure, and agent omission/failure.
The AI SDK multi-step loop runs with a mock language model that emits tool calls. These tests block external fetches.

The browser rehearsal uses scripted orchestration and fake payment outcomes in an isolated in-memory ledger. Its
second run shares that ledger to check duplicate creation. It is a workflow demonstration, not live-model evidence.
The actual June records are checked separately and remain untouched.

Verified on 2026-10-13: **212 tests passed**, TypeScript and ESLint passed, and the production build passed.
The local HTTP server returned the monthly desk and rehearsal button. The three rehearsal requests returned:

| Scenario | Simulated paid | Review cases | First-run invoices | Additional invoices on replay |
|---|---:|---:|---:|---:|
| Valid month | 3 | 0 | 3 | 0 |
| Missing agreement | 2 | 1 | 2 | 0 |
| Invoice amount mismatch | 2 | 1 | 3 | 0 |

Direct browser clicks were not verified because no controllable browser was connected. The HTML, HTTP handlers and
AI SDK tool loop were checked separately. The agreement and historical-invoice file hashes were unchanged.
The `/demo` route additionally exposes server-run rehearsal results for repeatable capture. Its normal and
amount-mismatch pages returned HTTP 200 and were captured from the running production server with HyperFrames.
Those captures show actual rendered results, not a recording of a user clicking the rehearsal button.

## Outstanding live verification

Live monthly Gemini tool selection, new sandbox issuing, PayPal-side concurrent creation and automatic debit have not
been exercised in this change. Vault, issuing, deployment and video publishing remain on hold. The existing sandbox
records cannot demonstrate a normal month at the newer agreement prices: all three require review.

The prototype reads one prepared June dataset, not arbitrary meter exports, and starts from the CLI rather than a
monthly scheduler. Customer payment requires the existing payment flow; this agent never pays on their behalf.
