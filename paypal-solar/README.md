# Solar Co-op — an operator desk for community energy payments

Solar Co-op connects a community operator's monthly energy allocation to consumer bills, producer payouts and payment exception review. Code calculates money, AI proposes, a person approves, and PayPal processes sandbox transactions.

The main submission is the **10-household operator workflow**: three producers and seven consumers. The older three-neighbour prototype is preserved for development history; it is not the judge walkthrough.

## Start here — no API keys required

**Hosted demo, no installation:** https://solar-coop.onrender.com/coop/demo: your own offline copy of the Haus 7 dispute, end to end. There is no PayPal call and no live AI call. Archived evidence is at `/coop?source=evidence`. This is the Render free tier, so the first request after inactivity can take about a minute. Operator writes are disabled there. To run everything locally:

Use Node.js 22 and npm. From the repository root:

```bash
cd paypal-solar
npm ci
npm run dev:workbench
```

Open **http://127.0.0.1:3007/coop?source=evidence**. The default `/` also opens the archived evidence on a fresh installation. No `.env.local`, provider account, data download or login is needed for these screens.

1. **Archived sandbox evidence:** `/coop?source=evidence` — seven bills, three payouts, €102.38 billed, €94.50 paid out, ten saved matched observations. Read-only; identifiers and operator name anonymized. These are archived observations, not current PayPal status.
2. **Saved AI evaluation:** `/coop/exceptions?source=holdout` — twelve synthetic cases and the saved real-model outputs, including Y11. One run scored 12/12 against 8/12 for the fixed baseline. Cases, answers and prompt came from the same team; this is not an independent benchmark or a claim of perfect reasoning.
3. **Interactive offline rehearsal:** `/coop?source=rehearsal` — click “Start offline June rehearsal”, select Haus 7, enter a reviewer name and attach the fictional meter question. Follow the bill check (meter → shared energy → bill → payment), prepare and review the checklist, add a manual evidence entry, record the explanation and the customer's confirmation. The checklist is a fixed template, explicitly not AI. Approval does not execute a payment; closing a dispute does not mark a bill paid or send a reply.

Follow [the judge walkthrough](docs/JUDGE_GUIDE.md). [Evidence manifest](docs/submission-evidence.json) records source hashes and redactions. Archived evidence is bundled independently from the ignored `runs/` directory and is never seeded into an executable payment ledger.

## What is implemented

- Integer-Wh meter CSV validation and allocation; integer-cent settlement.
- AI tool orchestration for settlement drafts and exception proposals, with evidence references and explicit unverified claims.
- Human approval, separate sandbox execution, idempotency and reconciliation.
- €500 per-payment and €5,000 account-wide daily limits, including concurrent executions.
- Bill check per statement: meter values + allocation rule → shared energy → billed kWh, price and amount → that statement's PayPal record. Consumption above the shared energy is explained as residual supply. Recorded values are never replaced by the recomputation; a bill is compared only with the meter file version and contract terms saved with its run, otherwise it is shown as not comparable.
- Payment state separates not sent, sent but not checked, sent and unpaid, and paid (reconciled PAID observation, with the checked field).
- Customer disputes (amount, metered energy, already paid) with their own status, separate from payment status: waiting for an external answer and correction needed stay open; closing records whether the customer confirmed or only the operator reviewed. Hand-entered evidence is labelled manual and never counts as a system check. Stale proposals and unknown evidence are rejected.
- AI agent investigation of a customer dispute: one pre-registered real run on the Haus 7 case (`experiments/h07-dispute`: input, prompt, criteria, raw model steps, judgement). The demo shows that saved proposal only when the case equals its recorded input; otherwise it shows a template, labelled not AI. One run on one fictional case, not an accuracy measure.

Consumers pay the operator; the operator pays producers. The AI does not hold funds. This prototype does not operate the grid, connect meters or bank accounts, settle supplier charges or calculate tax.

## Reproduce calculations and scores offline

```bash
npm test -- src/lib/coop/submission-evidence.test.ts
npm run coop -- rehearse 2026-06
npm run coop -- list 2026-06 --rehearsal
npx tsx scripts/cost-scenarios.ts
```

The evidence test recomputes the statement amounts from the submitted CSV and re-scores saved model outputs. It does not re-run Gemini or certify historical provider observations independently. The bundled prompt is `experiments/jev-grounding/fixtures/prompt-y-run.txt`; cases and accepted answers are in `src/lib/coop/exception-holdout.ts`.

## Full verification

The older energy allocation tests also require BDEW H25, which is not redistributed because no redistribution licence was established. Download that public source before running the full suite:

```bash
npm run fetch-data:h25
npm test
npx tsc --noEmit
npm run lint
npm run build
npm start
```

`fetch-data:h25` downloads only the BDEW profile; it does not replace committed PVGIS observations or saved agreements. The app and the demo run without that download, but the full `npm test` suite reads it: run `npm run fetch-data:h25` before `npm test`. Production `npm start` listens on port 3000; archived evidence remains visible and unauthenticated writes remain disabled. Do not enable `ALLOW_COOP_DESK_DECISIONS` on a public deployment without separate authentication.

See [verification status](docs/VERIFICATION.md) for the distinction between the standard test command and the restricted-environment fallback. `npm run test:in-process` is an alternative runner, not evidence that `npm test` or a production build succeeded.

## Optional provider setup

Only needed for new model/provider requests. Copy `.env.example` to `.env.local` and supply your own credentials. Never publish credentials or sandbox buyer passwords.

| Variable | Purpose |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Optional Gemini calls; subject to provider quota and pricing. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Your PayPal **sandbox** business app. |
| `ALLOW_COOP_SANDBOX=true` | Explicit gate for the separate payment execution CLI. Not needed for judging. |

See [cooperative settlement](docs/coop-settlement.md) for provider account configuration, the explicit execute command and reconciliation. Optional external execution is outside the default judge walkthrough. Jev is a separate unexecuted experiment and is not part of the product or setup.

## Why PayPal? What about bank payments?

PayPal is the payment provider implemented in this prototype: consumer invoices, producer payouts and payment status read back into the operator ledger. The archived sandbox observations demonstrate this integration. AI prepares proposals; a person approves payment actions; execution remains a separate step. The software and AI do not hold funds.

This is a product-integration choice, not a claim that PayPal is cheaper, faster or uniquely compatible with AI. [PayPal Invoicing](https://developer.paypal.com/invoicing/about/) supplies a hosted invoice payment page; [Payouts](https://developer.paypal.com/payouts/use-payouts/overview) supports email-addressed payments to eligible recipient accounts. Invoice payment options, including guest payment, depend on availability and eligibility. Producers must have or create eligible PayPal accounts to receive payouts; we have not established that the target producers already have or prefer them. Live Payouts access requires approval and sufficient funding.

| Alternative | What it can support | What remains to validate for this project |
|---|---|---|
| Bank transfer / SEPA Direct Debit | Bank-account collection and payment; direct debit requires a mandate. Provider APIs can supply statuses for automation and AI-assisted review. | Bank/provider access, consent flow, matching and outgoing-payment integration; complete operating cost. |
| Stripe / Mollie Connect | Collection and routing of funds to participating sellers. | Appropriate account structure, producer eligibility, onboarding and configuration-specific fees. |
| PayPal, implemented here | Invoices, producer payouts and status reconciliation in sandbox. | Production approval, participant preference, account eligibility and sustainable economics. |

Sources: [Stripe SEPA Direct Debit](https://docs.stripe.com/payments/sepa-debit), [Stripe Connect charge types](https://docs.stripe.com/connect/charges), [Mollie Connect](https://docs.mollie.com/docs/connect-overview). Bank payments are not uniformly slow: [SEPA Instant](https://www.ecb.europa.eu/paym/retail/instant_payments/html/index.en.html) supports transfers within ten seconds. Direct-debit collection has different timing. We have not benchmarked end-to-end payment speed.

Alternative-provider capabilities and public fees were researched on 14 October 2026. User preferences, integration effort and operational performance have not been comparatively validated. Collection-only fees must not be presented as the total cost of collecting from consumers and paying producers. No alternative rail is connected in this prototype: an asserted bank transfer remains unverified until independently checked by a person.

## Costs and limitations

For the modelled June CSV, a 1 ct/kWh operator fee leaves **€0.19 after assumed PayPal fees only**. A 2 ct scenario leaves €8.22 and reduces the producer price to 11 ct/kWh. Neither figure is profit. Labour, hosting, model, tax and other costs are excluded; human time savings have not been measured. The 1 ct/kWh figure is a demo assumption from a secondary source, not a pricing or revenue model. Assumptions and fee sources are in [the historical cost table](README-legacy.md#operator-money-after-paypal-fees) and `scripts/cost-scenarios.ts`.

The twelve-case evaluation is small and not independent. Evidence validation does not prove semantic correctness. Sandbox observations demonstrate prototype integration, not production eligibility or regulatory approval. The app has no scheduler or production operator authentication, and its ledger is local JSON files with file locks, not a persistent database; on the hosted demo the filesystem is not kept across restarts.

## Data and credits

- Map tiles and boundary data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. The grid-area polygon in `src/data/grid-area-frankfurt.json` is derived from OSM and is available under the ODbL 1.0.
- The NRM grid area is an approximation from the [Mainova price sheet (01.05.2024)](https://mainova.de/resource/blob/137504/ae75493a6122c1c4ceedb1a9b5b481fc/preisblatt-bsv-01-05-2024-data.pdf) ("Frankfurt am Main ohne die Stadtteile Höchst, Nied, Sindlingen, Sossenheim, Unterliederbach und Zeilsheim"), not an official balancing-area boundary. Syna GmbH area and the agreed Nied/Sossenheim transfer: [Mainova/Süwag press release, 14.02.2025](https://mainova.de/resource/blob/147230/c2bb9581986a66d2383323a980339cd7/20250214-pm-mainova-suewag-kooperation-data.pdf).
- Map library: [Leaflet](https://leafletjs.com) 1.9.4, BSD-2-Clause. Household positions on the map are fictional.
- More detail: [Data sources](DATA_SOURCES.md#grid-area-map-operator-desk).

## Project map

- `src/app/coop/`: operator desk and exception review.
- `src/lib/coop/`: settlement, guards, PayPal rail, reconciliation, AI and review logic.
- `src/data/coop-meter-2026-06.csv`: modelled input, not household meter readings.
- `src/data/submission/`: anonymized archived sandbox evidence.
- `experiments/jev-grounding/fixtures/`: preserved model outputs and prompts; no Jev dependency in the app.
- `docs/SUBMISSION.md`: English submission draft.
- `README-legacy.md`: historical prototypes and previous setup notes, not the main entry point.

[Data sources](DATA_SOURCES.md) · [Operator workflow](docs/operator-workbench.md) · [Judge guide](docs/JUDGE_GUIDE.md)
