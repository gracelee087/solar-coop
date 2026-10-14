## Operator workbench

Open `/coop` for the monthly operator desk: settlement → human approval → saved payment evidence → customer investigation.
The previous energy overview is at `/energy`. Start a key-free offline month from the first-run screen.

- `npm run dev:workbench` — local app at http://127.0.0.1:3007/coop
- `npm run test:in-process` — the same Vitest suite without esbuild subprocesses
- `npm run coop:investigate -- 2026-06 bill-ST-202606-H07 --rehearsal` — dry-run the optional model investigation

See [operator workflow, provenance and verification](docs/operator-workbench.md). Offline checklists are labelled templates, not AI. Reviewing a claim never confirms payment or sends a message.
# Neighbourhood solar sharing settlement (PayPal AI Hackathon)

A rooftop-solar owner shares electricity with three neighbours. The product target is a monthly settlement
that needs no operator intervention for valid bills. This prototype replays **June 2026** with modelled energy:

1. **Validate and calculate:** check all 2,880 quarter-hours, allocate energy and apply the saved agreement.
2. **Invoice once:** the agent calls guarded PayPal tools. Code owns prices, amounts, recipients and settlement keys.
3. **Reconcile:** compare the returned invoice ID, number, recipient, currency and amount. A `PAID` invoice also
   needs a matching paid amount and zero balance. Pending payment stays pending; `MARKED_AS_PAID` is not proof of PayPal payment.
4. **Record:** write a run report and flag exceptions for review. Missing terms, inconsistent records and uncertain
   failures must not trigger another bill. The CLI writes audit events before issuing and flushes them to disk.

The monthly AI agent selects `inspect_month`, `issue_invoice`, `check_payment` and `finish_month` through the AI SDK.
The existing billing agent uses the PayPal Agent Toolkit. The model cannot change a price or mark a bill paid by
writing a sentence. Historical price negotiation is preserved in the archive; monthly settlement never renegotiates.

Only the energy price between neighbours is settled here. Grid fees, levies and taxes stay with the electricity
supplier. Sandbox only: no real money moves.

Each household/month now has automatically collected **evidence tags** for saved terms, modelled usage, calculation
and invoice/payment observations. Open a case in the monthly desk to see sources, timestamps, snapshots and their
hashes. Missing or mismatched required evidence blocks billing. Supplier invoices, tax and refund sources are
explicitly **not connected**; paid energy bills do not mean all financial obligations are closed.
See [case evidence and remaining connectors](docs/case-evidence.md).
The monthly desk also exports a printable review packet and JSON evidence index. These are labelled demo drafts,
not tax returns: actual receipts, fees, refunds and tax treatment remain unknown until real supporting records exist.

> Status: prototype. The three earlier sandbox invoices have different prices from the saved agreements.
> Current preflight therefore reports **three review cases**, not a successfully settled month, and blocks rebilling.
> The new workflow is verified with fake payments and an AI SDK mock model. Live monthly Gemini execution and new
> sandbox invoice issuing have not been verified. Automatic debit/Vault and public deployment remain on hold.

Data and assumptions: [DATA_SOURCES.md](DATA_SOURCES.md).

## Monthly settlement workflow

```bash
npm run settlement:preview       # real saved records, local calculation only; no Gemini/PayPal calls
npm run settlement:rehearsal     # isolated fake ledger; run twice and report duplicate invoice count
```

Reports are written to `runs/monthly-settlement/` under unique names. That directory is ignored by Git.
The preview is a preflight, not an executed settlement. Rehearsal uses the saved prices and modelled usage with
**scripted orchestration and simulated customer payments**; it makes no model or PayPal calls and changes neither
`agreements.json` nor `issued-invoices.json`. The dashboard offers normal, missing-agreement and amount-mismatch cases.

For a repeatable demonstration, start the app and open `/demo`. This server-rendered page runs a fresh isolated
rehearsal and displays its result alongside the unchanged real preflight. Links select normal, missing-agreement
or amount-mismatch fixtures. It makes no Gemini or PayPal calls and does not imply a live AI run.

Optional CLI modes, **not run during this implementation**:

```bash
npx tsx scripts/monthly-settlement.ts agent-readonly
npx tsx scripts/monthly-settlement.ts agent-sandbox
```

Both agent modes can call Gemini and read sandbox invoices. Read-only mode refuses new issuing. The sandbox mode
additionally requires `ALLOW_MONTHLY_SANDBOX_ISSUING=true` after the issuing hold is lifted. It can create and send
sandbox invoices, but cannot pay, debit, refund or cancel them. `MONTHLY_AGENT_MODEL` selects the outer model; no
outer-model fallback restarts a partly executed month. Runs stop after 12 steps or a 120-second model deadline;
cancellation is propagated to billing tool guards. An already accepted remote request cannot be undone by cancellation.

Only June 2026 is currently supported; there is no scheduler or live meter integration. Start a later run to check
pending payments. The fixed invoice number and existing PayPal lookup remain the recovery mechanism after a crash;
a run report is an audit record, not a replacement invoice ledger. Human time savings and AI superiority over a
fixed workflow have **not** been measured. See [docs/monthly-settlement.md](docs/monthly-settlement.md) for verification scope.

## Operator money after PayPal fees

For the 10-household cooperative in [docs/coop-settlement.md](docs/coop-settlement.md) (7 bills, 3 payouts a month),
a local script computes what the operator keeps after PayPal fees. It makes no PayPal or Gemini call and does not
change the app's prices (13 ct/kWh, operator fee 1 ct/kWh). The scenarios live in this script and this table, not in
the app's screens.

```bash
npx tsx scripts/cost-scenarios.ts   # prints the tables below, writes runs/cost-scenarios/result.json (ignored by Git)
```

Fee assumptions, from the [PayPal DE fee page](https://www.paypal.com/de/business/paypal-business-fees) (last updated
7 September 2026, checked 14 October 2026):

- Bills: 2.99 % + 0.39 EUR per received payment ("Alle anderen geschäftlichen Transaktionen", domestic, EUR). The page
  lists no rate for invoices, so applying this row is an assumption.
- Payouts (Sammelzahlungen): 2 % per payment sent, capped at 12 EUR per payment (domestic, EUR).
- Fees are rounded to whole cents per transaction; the page states no rounding rule.
- "Remainder" = bills − payouts − PayPal fees. It is not profit: time, hosting, model, meter and tax costs are not
  included.

June 2026, modelled data (PVGIS weather and BDEW H25 loads, not metered), one setting changed at a time:

| Setting | Billed € | Paid out € | Fees € (bills + payouts) | Remainder € |
|---|---|---|---|---|
| Current: 13 ct, operator fee 1 ct, monthly | 102.38 | 94.50 | 5.80 + 1.89 | **0.19** |
| Proposed scenario: operator fee 2 ct (producers 11 ct) | 102.38 | 86.63 | 5.80 + 1.73 | 8.22 |
| Proposed scenario: operator fee 3 ct (producers 10 ct) | 102.38 | 78.75 | 5.80 + 1.58 | 16.25 |
| Assumed 1 € monthly base fee per consumer (no market source) | 109.38 | 94.50 | 6.01 + 1.89 | 6.98 |
| Sensitivity: bill fee 2.49 % + 0.35 EUR (not confirmed for invoices) | 102.38 | 94.50 | 5.00 + 1.89 | 0.99 |

Approximate year: June's feed-in scaled by the PVGIS monthly yield relative to June, June loads kept. This is an
approximation, not a measured year.

| Billing cycle | Bills + payouts | Fees €/year | Remainder €/year | Operator advance if producers are still paid monthly |
|---|---|---|---|---|
| Monthly (current) | 84 + 36 | 87.43 | **−0.48** | 0 |
| Proposed scenario: every 2 months | 42 + 18 | 71.00 | 15.88 | up to 188.93 € |
| Proposed scenario: quarterly | 28 + 12 | 65.59 | 21.30 | up to 282.92 € |

- The remainder column assumes producers are paid once at the end of each billing cycle (they wait up to 1 or 2 months
  longer).
- The advance column assumes producers are paid at each month end and consumers pay on time at the end of the cycle.
  Late payments make it larger.
- With the current settings, January, February and October to December are below zero.

Human time savings have not been measured.

## Setup

Tested with Node.js 22.16 on Windows.

```bash
cd paypal-solar
npm install
cp .env.example .env.local      # then fill in the keys (see below)
npm run fetch-data              # downloads PVGIS and BDEW H25 data into src/data/ (run it in this folder)
npm test                        # unit tests, no external calls
```

`.env.local` needs:

| Variable | Where to get it |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio API key. The free tier is enough. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal Developer Dashboard → Apps & Credentials → Sandbox app with **Invoicing** enabled |
| `GEMINI_MODELS` (optional) | Comma-separated models tried in order. Free-tier quotas are per model. |
| `LIVE_NEGOTIATIONS_PER_DAY` (optional) | Daily cap for the dashboard's live negotiation. Default 10. |

The invoices go to sandbox buyer accounts. To try it with your own sandbox, replace the e-mail addresses in
`src/lib/demo-group.ts` with your sandbox accounts.

## Dashboard

### Monthly correction prototype

`/demo/correction` connects a text correction to its invoice, computes a refund proposal, requests seller approval,
and independently checks the simulated refund result. It uses a real local Ollama model; payments are isolated simulations.
It includes a manual review timer, downloadable evidence and an illustrative monthly PayPal fee breakdown.
Run/setup, actual verification, limits and the payment integration boundary are documented in [correction-demo.md](docs/correction-demo.md).

```bash
npm run build
npm start                       # http://localhost:3000
```

The page opens with the monthly settlement desk, current-record preflight and isolated offline rehearsal.
It also shows, per neighbour: the modelled June results, a what-if slider for the price (computed in the browser,
not saved), the cost details, the collapsed saved-negotiation archive, the agreement, the settlement
preview, the recorded PayPal invoice status, a 15-minute allocation chart and the data sources.

Two parts call external services:

| Part | What it does | Limits |
|---|---|---|
| Live PayPal status (on page load and "check again") | Reads the issued sandbox invoices (read-only) and compares number and amount with the record. If the read fails, the page says so and keeps showing the recorded status, marked as recorded. | Answers cached for 60 s; concurrent requests share one read. |
| "Run a live negotiation (preview)" | Runs the two Gemini agents again for one neighbour. If a Gemini call fails, that agent falls back to the rule and the result is labelled accordingly. The result is a preview: the saved agreement, the settlement and the invoices are unchanged. | One run at a time, one per minute per visitor, a daily cap. Invalid requests are refused before they use any quota. |

Without keys the page still loads from the saved files: the status check then shows the recorded status, marked as recorded, and the live negotiation runs on the rule fallback.

The live-negotiation limits are kept in memory per server process: the daily cap (UTC day) counts negotiations,
not individual Gemini calls, and resets when the server restarts.

## Command line

All commands run in `paypal-solar/`. The scripts read `.env.local` themselves.

| Command | What it does | Uses |
|---|---|---|
| `npx tsx scripts/negotiate.ts --rules` | Price window and negotiation per neighbour, monthly economics. Nothing is saved. | nothing external |
| `npx tsx scripts/negotiate.ts` | The same with Gemini agents. Nothing is saved. | Gemini |
| `npx tsx scripts/agree.ts [--only=h2]` | Negotiates and saves the agreement for neighbours that have none yet. Existing agreements are skipped before any call. If a Gemini call fails, it stops; nothing rule-based is saved. | Gemini |
| `npx tsx scripts/settle.ts [--only=h1]` | The agent invoices each neighbour that has a saved agreement: agreed price × modelled shared energy. No negotiation happens here. Re-running returns the existing invoice. | Gemini, PayPal sandbox |
| `npx tsx scripts/explain.ts` | Settlement preview explanation per neighbour at the saved agreement price (the terms `settle.ts` bills). No negotiation happens here; a missing or unusable agreement skips that neighbour without a Gemini call. Not the explanation of the invoices issued earlier, which carry different prices. | Gemini |
| `npx tsx scripts/check-invoice.ts <INVOICE_ID>` | Status of an invoice, e.g. PAID after the neighbour paid | PayPal sandbox |
| `npx tsx scripts/list-invoices.ts` | Latest sandbox invoices | PayPal sandbox |
| `npx tsx scripts/cancel-invoice.ts <INVOICE_ID>` | Cancels a sent sandbox invoice, e.g. one created by mistake | PayPal sandbox |
| `npx tsx scripts/test-idempotency.ts` | Sandbox test: re-run, interrupted run, conflicting draft, concurrent runs. Cleans up after itself. | Gemini, PayPal sandbox |
| `npx tsx scripts/test-duplicate.ts` | Sandbox test: settling a neighbour again under the number of its paid invoice must not bill twice | Gemini, PayPal sandbox |

To pay an invoice, open its pay link, log in with the sandbox buyer account and pay with "PayPal balance".

## Licence

MIT, see [LICENSE](../LICENSE). PVGIS data © European Communities, 2001-2026. BDEW H25 is not redistributed.
