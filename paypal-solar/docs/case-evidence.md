# Evidence attached to one settlement case

Each household/month uses its existing settlement key as the case ID. Evidence is collected by server tools,
automatically, when the plan is prepared and when the agent checks an invoice. The model cannot set evidence
statuses or supply an arbitrary document URL. Its tool arguments remain household IDs only.

## What is collected now

| Tag | Collector / source | What it establishes |
| --- | --- | --- |
| Agreement | Saved agreement JSON, exact key, attached snapshot | Matching period, parties, allocation and price checks |
| Usage | Validated 2,880 modelled intervals, source file references, full-series digest and summary | Valid model input and the allocated quantity, not actual certified meter readings |
| Calculation | Deterministic calculation, attached bill input | Energy charge based on the agreement and usage tags |
| Invoice record | Historical local ledger, when present | Earlier recorded invoice and any conflict, not current payment |
| PayPal invoice | Response from the existing sandbox invoice reader, or labelled fake ledger | Invoice reconciliation outcome and the retrieved response |
| Payment | The same response and code checks | Paid total / balance checks, pending or mismatch |

Tags contain case ID, kind, status, source, observation timestamp, snapshot, SHA-256, note and dependency IDs.
`checked` describes the checks in the tag; it is not an issuer signature, legal certification, or live production
payment. Hashes identify content and detect changed snapshots/metadata within this pipeline; they are not tamper-proof
storage. Observations are appended within a run, including earlier missing tags. The UI opens each source snapshot.

Missing, cross-household or changed required evidence blocks issuing and payment verification. Retrieval failure
leaves evidence missing. Invoice mismatches are retained as evidence rather than discarded. Evidence is written to
the CLI's fsynced JSONL audit before issuing and before recording a paid outcome; a failed write blocks that outcome.
The final JSON report retains the tags. The browser rehearsal is deliberately ephemeral and simulated. It is not a
durable document-management service. Evidence is recollected on each run; there is no background retrieval scheduler.

The usage snapshot contains a summary and SHA-256 of the full normalized interval array, not a copy of the full array.
The local model input files must remain available for reproduction. No arbitrary PDFs, email or utility portals are
ingested in this change. Run reports may contain billing emails and agreement details; keep them local.

## What remains unconnected

Supplier/grid invoices, actual tax assessment/payment, customer refund and tax refund appear as `not_connected`.
Cost estimates are not payment receipts. Refund eligibility is unknown, not assumed. A paid energy invoice and a
finished agent run do not close all of these obligations. The existing agent cannot issue refunds or file tax claims.

PayPal invoice details expose payment/refund history. Recording an external refund is distinct from executing a
PayPal refund; a future connector must resolve the original transaction, use the applicable payment API and verify
the actual result. Do not mark a refund complete just because a record was added.

- [PayPal Invoicing reference](https://developer.paypal.com/invoicing/reference/)
- [PayPal Payments v2](https://developer.paypal.com/api/payments/v2)
- [BNetzA Energy Sharing: separate actors and network charges](https://www.bundesnetzagentur.de/DE/Vportal/Energie/Energy_Sharing/start.html)

Official API references checked on 2026-10-13. No new PayPal/Gemini request or refund was executed for this change.

Verified locally: 224 tests passed (12 new evidence tests plus the existing mock-model tool-loop assertion),
TypeScript, ESLint and production build passed. The saved CLI rehearsal report contains evidence for three cases;
the local production `/demo` response includes the evidence panels, hashes and unconnected-source labels.
HTTP mismatch rehearsal leaves two cases paid and one in review, with zero extra invoices on replay.
These are simulated payment checks; no live source collection or browser click was asserted.

## Review packet export

The monthly CLI additionally writes `-review.html` and `-review.json` beside each run report. The dashboard links to
the same local export at `/api/settlement-review?source=recorded&format=html` (or `format=json`). Explicit
`source=simulation` produces the labelled demo packet. `/demo/evidence` is a read-only evidence overview.

Packets contain a case register, calculated charges, checked payment observations and the full evidence index.
Real cash receipts, fees, refunds and taxable profit remain null/unknown. Modelled or sandbox observations must not
be treated as actual revenue. All packets say **DEMO DRAFT — NOT FOR TAX FILING**. Tax treatment is unassessed and
coverage is one month, not a complete fiscal year. Nothing is submitted to ELSTER. The printable HTML can be saved
or printed for review; it is not an official form. Preparation is deterministic code called after the workflow.

Export verification: 232 tests pass (including 8 packet/endpoint tests); build includes TypeScript and ESLint checks.
Tests cover unknown versus zero, exclusion of mismatched/tampered payment evidence, HTML escaping, invalid parameters
and historical records that must not become current paid observations.

## Next complete-case experiment (not implemented)

Use one explicitly fictional correction: paid energy charge EUR 15, corrected usage gives EUR 13. Link the original
agreement, both usage versions, original invoice/payment, deterministic EUR 2 adjustment, authorized refund request
and confirmed refund evidence. Retain both versions. Measure correct document association, calculated difference,
duplicate-refund prevention and required human interventions. Treat supplier credits and tax refunds as separate
obligations with their own source, authority and period; an annual assessment can link to multiple monthly cases.

This experiment has not yet been run. Production utility/tax connectors, authorizations, document authenticity,
retention/access control and end-to-end live AI collection still need implementation and verification.
