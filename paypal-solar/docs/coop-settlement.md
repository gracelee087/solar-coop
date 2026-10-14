# Cooperative settlement — development notes

> These notes preserve staged implementation history. For the current submission, use [the judge guide](JUDGE_GUIDE.md) and [verification status](VERIFICATION.md). The bundled archive now records the completed ten-item sandbox run; earlier “not verified” notes below describe those earlier stages, not the archive.

Operator model for § 42c EnWG energy sharing: several producer households feed PV into one pool, consumer households
take their static share, the operator (e.g. a cooperative) bills consumers and pays producers. Code in `src/lib/coop/`.

| File | What it does |
|---|---|
| `types.ts` | Participants, PV assets, 15-minute meter intervals, allocations, statements |
| `meter-csv.ts` | Reads/writes the meter CSV (no BNetzA standard format exists yet) and rejects gaps, bad values, incomplete months |
| `allocation.ts` | Pooled static allocation per 15 minutes, credited to producers by feed-in share; monthly aggregation |
| `statements.ts` | Consumer bills and producer payouts; checks bills = payouts + operator share |
| `limits.ts` | 500 € / 5,000 € hard limits, DSGVO-safe payment memo |
| `ledger.ts` | Draft → human approval → execution, duplicate-safe drafts, refunds capped by the bill, no automatic retry |
| `rail.ts` | `PaymentRail` interface and PayPal sandbox adapter (Invoicing v2, Payouts v1, capture refund) |
| `tools.ts` | Agent tools: `calculate_settlement`, `draft_invoice`, `request_approval`, `execute_payment`, `refund` |
| `sample-group.ts` | 10 illustrative households (3 producers, 7 consumers), price 13 ct, operator fee 1 ct (assumptions) |

Sample data: `npm run coop:sample` writes `src/data/coop-meter-2026-06.csv` (modelled from PVGIS Frankfurt June 2023
weather and the BDEW H25 profile, not metered; needs `npm run fetch-data` first for the H25 file).

## Stage 2: monthly agent run and approval queue

| File | What it does |
|---|---|
| `agent.ts` | The model drives calculate_settlement → draft_invoice / draft_payout → request_approval → add_approval_note. No execute or approve tool. Code decides completion |
| `approval.ts` | Facts and anomaly flags per draft (decided by code), code-built default summary, note check |
| `state.ts` | Saves drafts and queue per period (`runs/coop/` or `runs/coop-rehearsal/`, git-ignored) |
| `rehearsal.ts` | Scripted stand-in model for offline rehearsals and tests (not a model) |

Note check: every number must carry its unit and equal the fact with that unit (€ amount, kWh, ct, %), any other
digit is rejected, and a rejected note is replaced by the code-built summary. Limitation: the two kWh facts (shared and
total) share a unit, so a note swapping those two would pass.

```
npm run coop -- rehearse 2026-06                          # scripted, offline
npm run coop -- run 2026-06                               # Gemini (not run yet)
npm run coop -- list 2026-06 [--rehearsal]
npm run coop -- approve 2026-06 <draftId> <name> [--rehearsal]
npm run coop -- reject 2026-06 <draftId> <name> <reason> [--rehearsal]
```
Executing approved payments is not part of this command.

## Verified / not verified
- Unit tests (`src/lib/coop/coop.test.ts`) cover the allocation invariants on every interval of the sample month,
  settlement balance, CSV validation, limits, approval flow, refunds and the PayPal request shapes with a fake HTTP client.
- [2026-10-14] First sandbox run: one bill (ST-202606-H04, invoice SENT) and one payout (PO-202606-H03, batch SUCCESS)
  executed through `npm run coop -- execute`; households play the three existing sandbox personal accounts.
- The PayPal adapter's request shapes follow PayPal's published OpenAPI schemas (checked 2026-10-14) but have **not**
  been run against the sandbox. Whether an invoice payment can be refunded through the capture refund endpoint, and
  whether the sandbox app has Payouts enabled, is not verified.
- The stage 2 agent loop is tested only with a scripted mock model; a real Gemini run has not been done.
- Not modelled yet: VAT, PayPal fees.

## Approval desk (`/coop`)
Page `src/app/coop/` reads the saved run for the period (`?period=YYYY-MM`, default 2026-06): the Gemini run in
`runs/coop/` if present, otherwise the scripted rehearsal, and says which. It shows totals, counts, each draft with its
summary (agent note or code-built), flags and decision. Approve/reject needs a name (free text, not a login) and a
reason to reject; `POST /api/coop/decision` (`src/lib/coop/desk.ts`) records it in the saved state (409 if already
decided). There is no execute button; no PayPal or Gemini call happens on this page.
