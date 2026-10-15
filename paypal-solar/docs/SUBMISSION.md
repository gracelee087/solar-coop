# Solar Co-op

## Tagline

Collect bills, pay producers, and reconcile community energy payments with PayPal.

Solar Co-op helps energy-sharing operators manage monthly settlement. Code calculates amounts, AI prepares drafts and proposes checks for disputes, and people approve payment actions.

## Inspiration

Sharing electricity creates a second job: sharing the money. Under § 42c EnWG, in force since 1 June 2026, neighbours in Germany can share solar power through the public grid. Someone has to calculate each household's bill, collect it, pay the producers, check that the money arrived and answer questions such as "my meter shows more than your bill".

Billing questions are already common in German energy. In 2025 the national energy arbitration body, Schlichtungsstelle Energie, counted 4,156 dispute reasons about disputed consumption ([annual report 2025](https://www.schlichtungsstelle-energie.de/presse.html?file=files/sse/content/pdf/presse/Taetigkeitsbericht%20SSE%202025.pdf)). These cover all energy disputes, not energy sharing only; one case can have more than one reason, and a disputed reading is not a proven meter error. Energy sharing adds a step that is easy to misread: a household's meter total is not the energy it is billed for. Only the shared solar part appears on the sharing bill; the rest comes from the household's own supplier.

## What it does

Solar Co-op is a desk for the operator who runs a group's monthly settlement. Consumers receive bills and pay them; producers receive payouts. The month runs in six steps:

1. **Calculate.** Quarter-hour meter data and the allocation rule give each household's shared energy. Code computes consumer bills and producer payouts in whole Wh and cents. Modelled June month: ten households, seven consumer bills (€102.38) and three producer payouts (€94.50).
2. **Prepare drafts.** An AI agent calls the implemented tools to draft the seven PayPal invoices and three payouts and writes a short note for each. Code checks the numbers in its notes. In this run the agent has no approval or execution tool.
3. **Approve.** The operator approves each draft. Code enforces €500 per payment and €5,000 per day and prevents duplicates. Approval and execution are separate steps.
4. **Collect with PayPal Invoicing.** PayPal e-mails each consumer the invoice. They pay with a PayPal account or, without one, by debit or credit card from the invoice ([PayPal help](https://www.paypal.com/de/cshelp/article/wie-bezahle-ich-eine-geldanforderung-oder-eine-rechnung-help316)).
5. **Pay producers with PayPal Payouts.** Payouts go from the operator's PayPal account to each producer's e-mail address. A producer without a PayPal account receives a notification and a sign-up link; an unclaimed payout returns to the sender after 30 days ([PayPal developer docs](https://developer.paypal.com/docs/payouts/standard/reference/payment-processing/)).
6. **Reconcile.** PayPal's status comes back to the ledger and is matched to each statement by amount, reference and status. In our sandbox run: 7 invoices PAID, 3 payouts SUCCESS, 10 of 10 matched.

Collection and payouts are separate, human-approved actions. The desk does not wait for invoices to be paid before a payout and does not distribute collected money automatically. It does not check the operator's PayPal balance before a payout; a payout that PayPal refuses is recorded as failed and never retried. An unpaid invoice shows as "Sent · not paid". An unclaimed payout stays pending with the 30-day note; the desk does not track that deadline.

**When something goes wrong.** A customer can question a bill or say they already paid. The desk keeps one case per statement:

- **Bill check, link by link, in code.** Haus 7 writes: "My meter shows about 193 kWh for June, but your bill says 95.1 kWh." Meter: 192.6 kWh. Allocation: 14 % of the pooled feed-in each quarter-hour, at most what the household used, gives 95.1 kWh of shared solar. Residual: 97.5 kWh from the household's own supplier, 82.1 kWh of it in quarter-hours when no solar was shared. Bill: 95.1 kWh × 13.00 ct = €12.36, equal to the recomputation. A bill is compared only with the meter file version and contract terms it was billed from; otherwise it is "not comparable".
- **Evidence.** Replies from a metering operator, grid operator or customer are recorded as manual entries. They never count as a system check, even when they name PayPal or a transaction ID.
- **AI proposal.** An AI agent reads the statement through a tool, cites evidence IDs, lists what is still unverified, suggests checks and drafts a reply. It sends nothing. For Haus 7 we recorded one real run (see What we verified).
- **Outcome.** The operator records the review, the explanation and the customer's answer. The case closes as "customer confirmed" or "closed after operator review".

The dispute status and the payment status stay separate. Closing a dispute never marks a bill paid, and a sent invoice is not a paid one. A bill counts as paid only when a reconciled PayPal observation reports PAID.

The desk also has a grid-area map and a per-household chart for the month.

## Why PayPal

PayPal covers both directions of the money in one operating flow. Invoicing collects from consumers; Payouts pays producers. Our desk connects both and matches PayPal's results against the bill and payout drafts. Both sides carry the statement reference, so payment observations come back into the same ledger the bill check reads.

PayPal confirms its own payment records. It does not tell us whether a meter value is right, which is why the desk keeps meter, bill and payment as separate links. We do not claim that only PayPal can do this, or that it is cheaper or faster than a bank.

**Scope.** Consumers pay through PayPal invoices, by PayPal account or card. Producers receive PayPal payouts and need a PayPal account to claim them. The desk does not import or match bank transactions today. If operators must keep bank transfers, that connection would come first. The intended fit is a small group that agrees to settle through PayPal; we have not surveyed this. Production Payouts access still needs PayPal approval.

**Who holds the money depends on the contract.** Under § 42c the consumer pays the plant operator. A desk that collects money and passes it on would need a payment-services (ZAG) review. We make no claim about any party's legal status.

## How we built it

- **Desk:** Next.js, React and TypeScript.
- **Calculations:** deterministic code validates quarter-hour CSVs and computes integer-Wh allocation and integer-cent amounts. The bill check reads the recorded values from the ledger and never replaces them with the recomputation. Each run saves the hash of its meter file and its contract terms.
- **AI agent:** AI SDK tools limit the model to the implemented operations. Gemini was used for the recorded agent runs.
- **Payments:** the payment rail calls the PayPal sandbox: Invoicing v2 to create and send invoices, Payouts v1 to pay producers by e-mail, and status reads for reconciliation.

Payment drafts need human approval before execution. Code enforces amount limits, duplicate prevention, account-wide locking and reconciliation checks. Case actions are code-checked state changes. For example, an explanation can be recorded only when the bill check matches, and a payment claim can be closed only against a reconciled payment. Archived observations are included as read-only submission evidence, separate from runtime ledgers.

Built from scratch during the Submission Period: the first commit is dated 2026-10-12.

## Built with

Next.js, React, TypeScript, PayPal Invoicing v2 and Payouts v1 (sandbox), Render (hosting, free web service), Vercel AI SDK, Google Gemini (`gemini-3.5-flash-lite`, for the recorded agent runs), Leaflet with OpenStreetMap data, Vitest. The demo video narration is local text-to-speech (Kokoro).

## Challenges

**Total consumption is not the billed energy.** Our first plan compared the meter total with the billed kWh. That would have flagged every correct bill. The check now follows the actual rule: meter values plus allocation give the shared energy, the bill follows from it, and the rest is explained as residual supply.

**Some steps look alike but must stay separate:**
- an invoice sent vs. an invoice paid
- an operator closing a case vs. a customer confirming it
- a typed-in PayPal transaction ID vs. a reconciled PayPal record

**A payment claim is not payment evidence.** Concurrent executions could also defeat a daily limit unless reservations across all months were checked under one account lock.

Evidence checks remain imperfect. Validating evidence IDs and numbers does not establish that an explanation is correct.

## What we verified

- **Archive:** the submitted evidence records ten matched PayPal sandbox observations. Judges can inspect that archive without credentials and recalculate its statement amounts from the bundled CSV.
- **Bill check tests:** on normal bills it finds no mismatch, even though consumption exceeds the shared energy. On bills with a deliberately changed amount, kWh or price it reports a mismatch. On a changed meter file or changed contract terms it reports "not comparable".
- **Archive bills show "not comparable":** that run predates saving the billing inputs. Its recomputed amounts equal the recorded ones.
- **Saved Gemini run:** it selected accepted actions on 12 of 12 synthetic payment-exception cases, against 8 of 12 for the fixed baseline. This was one run, and the same team wrote the cases, expected answers and prompt, so it is not an independent benchmark.
- **AI agent on the Haus 7 dispute:** before running it, we committed the input, prompt, model and four criteria. Then we ran the agent once (`experiments/h07-dispute`): one attempt, two model requests, and the code checks accepted the proposal.
  - **Our judgement:** all four criteria pass, with quoted text. The proposal keeps 192.6 kWh total apart from the 95.1 kWh billed and the 97.5 kWh residual. It uses only numbers from the evidence, does not present the hand-entered reply as a system check, and does not imply payment.
  - **Weaknesses we saw:** it cites every evidence ID, puts IDs in the customer reply, and does not flag the manual entry as unverified.
  - **Where it is shown:** the demo loads this saved proposal only when a visitor's case equals the recorded input. Otherwise it uses the code template, labelled "not AI". No model is called on the hosted site.
  - This is one run on one fictional case, not an accuracy measurement.

See `VERIFICATION.md` for current test and build status. A test count is not a quality or performance guarantee.

## What we learned

Provider fees materially affect small groups. With our modelled June data and stated fee assumptions, a 1 ct/kWh operator fee leaves €0.19 after deducting PayPal fees only. A 2 ct scenario leaves €8.22 while reducing producer compensation. Neither is profit. The 1 ct/kWh figure is a demo assumption from a secondary source, not our pricing, and these scenarios are not a revenue model.

## What's next

Three things are not yet validated:

1. **Problem and customer:** will real groups settle through PayPal, and which exceptions cost operators time? We need real settlement months and exception cases from an energy-sharing operator. No operator has agreed to a pilot yet.
2. **Product:** compared with their current process, does the desk reduce working time, missed issues or wrong proposals? A pilot must measure staff working time separately from time spent waiting for metering or grid operators.
3. **Business:** does the saving exceed the cost of using it, and will operators pay? Our pricing hypothesis is a monthly subscription paid by operators; it is not validated.

Bank transaction import and matching is not implemented. If operators must keep bank transfers, it would come next, kept separate from PayPal records. We would decide this after asking operators.

**Before production use:**
- operator login, roles and per-organisation data separation
- a persistent ledger with backups
- recovery and monitoring for failed payments
- real meter data, including corrections, and corrected statements
- independent evaluation of the AI agent's proposals
- the payment-services and PayPal approvals above

## Testing instructions

No credentials or installation needed: **https://solar-coop.onrender.com/coop/demo**. This is the Render free tier, so the first request after inactivity can take about a minute. Each visitor gets their own offline copy. There is no PayPal call and no live AI call. Data are fictional and cleared after 24 hours or on a restart.

The demo shows one step per screen. Each screen says what it shows; **Back** reviews earlier steps and **Start over** runs it again.

1. Click **Start the demo**. **This month:** seven consumer bills (€102.38) for PayPal Invoicing and three producer payouts (€94.50) for PayPal Payouts, calculated in code. Click **Next**.
2. **PayPal collects and pays out:** the archived sandbox run, 7 of 7 invoices PAID, 3 of 3 payouts SUCCESS, 10 of 10 matched. No new PayPal call. Click **Next**.
3. **When something goes wrong:** Haus 7, a separate fictional case, doubts its bill: 192.6 kWh metered = 95.1 kWh shared solar on this bill + 97.5 kWh from the household's own supplier. Click **Next**.
4. Click **Add this reply as evidence** (a fictional metering-operator reply), then **Next**.
5. Click **Load saved AI proposal**. Expected: **Saved real AI proposal · one recorded run**, with an unsent reply draft. No model is called. Click **Next**.
6. Click **Record review**, **Record explanation sent** and **Record customer confirmation**, each followed by **Next**. A suggested note is filled in.

Expected: "Demo complete: the dispute is closed", with the Haus 7 rehearsal payment still "Not sent · not paid". The archived payment results and this fictional case are separate; the walkthrough does not settle a new month. The same guided flow runs locally with `npm ci` and `npm run dev:workbench` in `paypal-solar`, at `/coop/demo`. The full operator rehearsal is at `/coop?source=rehearsal`.

Other pages:
- `http://127.0.0.1:3007/coop?source=evidence`: archived sandbox evidence (read-only, 10 of 10 matched).
- `http://127.0.0.1:3007/coop/exceptions?source=holdout`: saved AI agent run on twelve team-authored synthetic cases.

These paths make no live PayPal or model calls. A live run needs the judge's own PayPal sandbox app and Gemini API key in `.env.local`; the variable names are in `.env.example`, and setup is in `docs/coop-settlement.md`.

## Submission links

- Hosted demo: https://solar-coop.onrender.com/coop/demo
- Video: https://youtu.be/hojPv-chuG8
- Source: https://github.com/gracelee087/solar-coop

The local judge guide is `docs/JUDGE_GUIDE.md`.
