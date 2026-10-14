# Solar Co-op

## Tagline

An operator desk that turns shared solar energy into clear bills, producer payouts and human-reviewed payment exceptions.

## Inspiration

Sharing electricity creates a second challenge: sharing the payment work. A small community operator must calculate each household's bill, pay producers, reconcile transactions and handle messages such as “I already paid.” We built a focused desk for that operator.

## What it does

Solar Co-op takes a month of quarter-hour energy data and calculates consumer bills and producer payouts. An AI agent can prepare drafts and propose how to handle payment exceptions. A person approves payment drafts; execution is a separate step. PayPal transaction observations return to the ledger for reconciliation.

Facts, customer claims and proposals are displayed separately. A customer message or human review cannot mark a payment as received. In the ten-household modelled June example, the desk contains seven bills and three producer payouts.

## Why PayPal

Our prototype uses PayPal Invoicing for consumer bills and Payouts for payments to producers' eligible PayPal accounts. Keeping both sides linked to statement references gives the operator a coherent reconciliation view. The intended fit is a small group whose members hold or can open PayPal accounts (an assumption we have not surveyed); it does not mean PayPal is universally cheapest or uniquely capable of AI-assisted payments. Production Payouts access and participant eligibility still need confirmation.

## How we built it

Next.js, React and TypeScript provide the desk. Deterministic code validates quarter-hour CSVs and computes integer-Wh allocation and integer-cent amounts. AI SDK tools constrain the model to the implemented operations. Gemini was used for recorded agent runs. The cooperative payment rail calls PayPal sandbox APIs; earlier prototype paths also explore the PayPal Agent Toolkit.

Payment drafts require human approval before execution. Amount limits, duplicate prevention, account-wide locking and reconciliation checks are enforced by code. The model cannot change prices through an explanation or approve its own payment draft. Archived observations are included as read-only submission evidence, separate from runtime ledgers.

Built from scratch during the Submission Period: the first commit is dated 2026-10-12.

## Built with

Next.js, React, TypeScript, PayPal Invoicing v2 and Payouts v1 (sandbox), Vercel AI SDK, Google Gemini (`gemini-3.5-flash-lite`, Google AI Studio free tier, for the recorded agent runs), PayPal Agent Toolkit (earlier prototype path, `src/lib/paypal-tools.ts`), Vitest. The demo video narration is local text-to-speech (Kokoro).

## Challenges

A payment claim is not payment evidence. We separated unverified customer messages from provider observations and made missing bank connectivity explicit. We also found that concurrent executions could defeat a daily limit unless reservations across all months were checked under one account lock. Explanation checks remain imperfect: validating evidence references and numbers does not establish semantic correctness.

## What we verified

The submitted evidence records ten matched PayPal sandbox observations. Judges can inspect that archive without credentials and recalculate its statement amounts from the bundled CSV. A separate saved Gemini run selected accepted actions on 12 of 12 synthetic exception cases, compared with 8 of 12 for the fixed baseline. This was one run; cases, expected answers and prompt were written by the same team, so it is not an independent benchmark.

The new integrated customer-investigation command has mock-model tests but no real-model evaluation. Its interactive demonstration uses a clearly labelled offline template. See `VERIFICATION.md` for current test and build status rather than treating a test count as a quality or performance guarantee.

## What we learned

Provider fees materially affect small groups. With our modelled June data and stated fee assumptions, a 1 ct/kWh operator fee leaves €0.19 after PayPal fees only. A 2 ct scenario leaves €8.22 while reducing producer compensation. Neither is profit, and we have not measured human time savings. Making these trade-offs visible is part of the product.

## What's next

Independent evaluation of exception reasoning, operator authentication, real meter and bank connectors, provider confirmation for the commercial operating model, and measured operator trials. We would validate these before production use.

## Testing instructions

No credentials are needed for the judge path. With Node 22: `npm ci`, then `npm run dev:workbench` in `paypal-solar`, then open:

- `http://127.0.0.1:3007/coop?source=evidence` — archived sandbox evidence (read-only, 10 of 10 matched)
- `http://127.0.0.1:3007/coop/exceptions?source=holdout` — saved AI agent run on twelve team-authored synthetic cases
- `http://127.0.0.1:3007/coop?source=rehearsal` — interactive offline rehearsal (fixed template, not AI)

These paths replay saved PayPal and model records; they make no live calls. A live run needs the judge's own PayPal sandbox app and Gemini API key in `.env.local` (names in `.env.example`); see `docs/coop-settlement.md`. We do not share our keys or sandbox passwords.

## Submission links — pending publication

The source repository, public video and any hosted demo URLs must be filled with verified published links in Devpost. No public URL is claimed in this draft. The local judge guide is `docs/JUDGE_GUIDE.md`; it supplies a no-key execution path.
