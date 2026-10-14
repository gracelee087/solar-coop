# Monthly settlement: document correction and refund confirmation

Anna is the seller. The buyer has paid a monthly electricity bill. A correction arrives later:
which transaction does it belong to, what remains to return, and has the refund actually completed?
This prototype implements that workflow with a real **local document model** and an isolated **simulated payment provider**.
It does not establish that PayPal is the cheapest payment option or that this is a universal problem in all energy-sharing services.

## Working scope

- `/demo/correction`: German sample or UTF-8 text upload, source quotations, transaction matching, cent-based calculation,
  seller approval, refund request, independent refund/ledger read-back, evidence download.
- The model extracts identities, the corrected total and source quotations. It cannot pick a capture ID,
  set a refund amount, approve a payment, mark evidence verified or declare the case resolved.
- Code orchestrates the workflow. Payment and refund observations, not model prose, determine completion.
- `COMPLETED` refunds count; pending and unknown outcomes remain open. Already completed partial refunds are deducted.
- Repeated and concurrent approvals within one demo session do not submit a second request. A lost response is never automatically retried.
- Source quotes and hashes check provenance/integrity inside this workflow, **not document authenticity or semantic infallibility**.
  The seller must inspect the source and approve. A fake uploaded invoice is not financial authority.
- No PDF/image OCR, bank import, automatic meter correction calculation, scheduled monitoring, live refund or notification delivery.
  A correction total is read from the document, not independently reconstructed from a new meter dataset.

## Run locally

Install/start Ollama with `gemma4:e4b` available. This project does not download the model automatically.
The endpoint is fixed at `127.0.0.1:11434`; there is no cloud fallback. In PowerShell:

```powershell
$env:CORRECTION_LOCAL_AI='1'
npx next dev --hostname 127.0.0.1 --port 3196
```

Open `http://127.0.0.1:3196/demo/correction`. The API is disabled unless opted in and restricted to loopback/same-origin use.
It serializes model requests and retains up to 30 demo sessions for one hour in one process.
These are disposable simulated ledgers, not a persistent production financial journal.
Restarting creates no risk to real funds because no live payment adapter is accepted.

CLI reproductions (local model calls, no PayPal/Gemini calls):

```powershell
npx tsx scripts/correction-demo.ts
npx tsx scripts/correction-demo.ts --draft
```

The first should reconcile 15.00 paid − 2.00 returned = 13.00 corrected total with one simulated refund.
The second should identify the draft correction and keep it under review without a refund request.
Each execution freezes the input/prompt/schema before inference and saves the raw model output and event record in `runs/correction/`.
These are development fixtures, not a blinded performance evaluation. Earlier failures are retained in the evidence notes.

## Monthly payment and fees

Keep 15-minute energy allocations in the usage ledger; bill each buyer once per month.
Do not create a payment per energy interval. This is already the existing monthly settlement design.

The demo displays an **illustrative** German standard Checkout rate of 2.99% + EUR 0.39 (checked 2026-10-14):
EUR 15.00 gross → EUR 0.84 fee → EUR 14.16 seller net before a correction.
The rate depends on product/account terms; this is not a verified charge on an existing sandbox invoice.
Refund fee adjustments are not modelled. Customer debt reconciliation and seller net proceeds are separate.
Do not claim the EUR 2 correction is an energy-price saving.

Source: [PayPal Germany merchant fees](https://www.paypal.com/de/business/paypal-business-fees).
PayPal is a payment integration choice; commercial viability requires comparing fee-adjusted benefit and administrative effort with bank/SEPA options.

## Measurement protocol

The UI provides a timed manual review exercise with the **same sample document and payment records**.
Both the manual and AI measurements end at the refund proposal, before seller approval.
Manual answers: identify the invoice, corrected total, completed payment and refund due. Failed submissions are recorded.
Interaction counts include start, field focuses and submissions for manual work, or the start click for AI.
They exclude document upload, reading and general navigation, so they are not total effort.

Run manual review first, before exposing the AI answer. Label repeated trials as practised, not blind.
Export records with participant consent; do not call automated browser runs human measurements.
The page does not invent a manual duration or automatically claim a time-saving percentage.
Human participant measurements remain outstanding. Local model runtime is machine latency, not time saved.

## PayPal integration boundary

Existing invoice/status integration remains unchanged. The new payment port is deliberately simulation-only.
The existing invoice transaction IDs have not been verified as Payments v2 capture IDs; do not assume compatibility.
For a live implementation, first establish the trusted invoice→capture relationship and merchant authorization,
then add durable per-capture locking, a persistent request journal and recovery for uncertain outcomes.

- Actual captured-payment refunds: [POST /v2/payments/captures/{capture_id}/refund](https://developer.paypal.com/api/payments/v2/captures-refund).
- Independent confirmation: [GET /v2/payments/refunds/{refund_id}](https://developer.paypal.com/api/payments/v2/refunds-get).
- Invoicing `record-refund` is a separate recording operation; it must not be presented as money movement.

## Verification and boundaries

Unit/route tests exercise normal completion, prior partial refunds, pending status, uncertain responses,
concurrency/replay, stale approval, wrong identities/currencies, ungrounded quotes and independent confirmation mismatches.
Real local model results and failure notes are in `docs/evidence/correction/`.
Browser access was denied by the browser tool; visual layout and click-through were not verified in that environment.
No existing saved agreement or issued invoice is changed. Vault, live money movement, deployment and upload remain on hold.
