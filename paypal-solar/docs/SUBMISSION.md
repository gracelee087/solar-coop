# Solar Co-op

## Tagline

A settlement desk for energy sharing: it lines up meter, billing and PayPal records, lets an AI agent propose the next checks, and records how each customer dispute was handled.

## Inspiration

Sharing electricity creates a second job: sharing the billing work. Under § 42c EnWG a plant operator may hand consumer billing to a third party (Abs. 5). That party must calculate each household's bill, pay producers, check payments and answer questions such as "my meter shows more than your bill".

Billing disputes are already common in German energy. In 2025 the national energy arbitration body, Schlichtungsstelle Energie, counted 4,156 dispute reasons about disputed consumption ([annual report 2025](https://www.schlichtungsstelle-energie.de/presse.html?file=files/sse/content/pdf/presse/Taetigkeitsbericht%20SSE%202025.pdf)). One case can have more than one reason, and a disputed reading is not a proven meter error. Energy sharing adds a step that is easy to misread: a household's meter total is not the energy it is billed for. Only the shared solar part appears on the sharing bill. The rest comes from the household's own supplier.

## What it does

Solar Co-op gathers mismatches between meter, billing and payment records in one place. An AI agent proposes the evidence and the next checks, and the operator records each step and the evidence that settled the case.

One fictional case, end to end:

1. **Dispute received.** Haus 7 writes: "My meter shows about 193 kWh for June, but your bill says 95.1 kWh." The operator attaches the message to that exact statement and marks it as a metered-energy dispute.
2. **Source records compared.** The bill check works link by link, in code:
   - **Meter:** 15-minute values, 192.6 kWh in total.
   - **Allocation:** 14 % of the pooled feed-in each quarter-hour, at most what the household used. That gives 95.1 kWh of shared solar.
   - **Residual:** 97.5 kWh from the household's own supplier, of which 82.1 kWh fell in quarter-hours when no solar was shared.
   - **Bill:** 95.1 kWh × 13.00 ct = €12.36, equal to the recomputation.
   - **Payment:** the PayPal record for that statement.
3. **Mismatches and unknowns flagged.** A bill is compared only with the meter file version and contract terms it was billed from; otherwise it is shown as "not comparable". A changed amount, kWh or price shows up as a mismatch.
4. **Next checks proposed.** An AI agent reads the statement through a tool and proposes: it cites evidence IDs, lists what is still unverified, suggests checks and drafts a reply. It does not send the reply. For this case we recorded one real run (see What we verified).
5. **Human review.** The operator records what they will check.
6. **Evidence added.** The operator records the metering operator's reply. Entries typed in by hand are labelled as manual and never count as a system check, even when they name PayPal or a transaction ID. New evidence makes the proposal out of date until it is prepared and reviewed again.
7. **Outcome recorded.** The case is closed in one of two ways: "customer confirmed" or "closed after operator review, no customer confirmation". Waiting for an external answer and a needed correction both stay open.

The dispute status and the payment status are separate. Closing a dispute does not mark a bill paid, and a sent invoice is not a paid one. A bill counts as paid only when a reconciled PayPal observation reports PAID, and the desk shows which field was checked.

The month view covers ten modelled households: three producers and seven consumers, with seven bills and three producer payouts. It has a grid-area map and a per-household chart.

## Why PayPal

Our prototype uses PayPal Invoicing for consumer bills and Payouts for payments to producers' eligible PayPal accounts. Both sides carry the statement reference, so payment observations come back into the same ledger the bill check reads. PayPal confirms its own payment records. It does not tell us whether a meter value is right; that is why the desk keeps meter, bill and payment as separate links.

The intended fit is a small group whose members hold or can open PayPal accounts. We have not surveyed this. It does not mean PayPal is universally cheapest or uniquely capable of AI-assisted payments. Production Payouts access and participant eligibility still need confirmation.

Who collects and who pays out depends on the contract. Under § 42c the consumer pays the plant operator. A desk that also collects money and passes it on would need a payment-services (ZAG) review and PayPal approval for live Payouts or platform use. Our first product therefore runs alongside an operator's existing billing and payment path: same month's data, recalculated and reconciled, with disputes recorded.

## How we built it

- **Desk:** Next.js, React and TypeScript.
- **Calculations:** deterministic code validates quarter-hour CSVs and computes integer-Wh allocation and integer-cent amounts. The bill check reads the recorded values from the ledger and never replaces them with the recomputation. Each run saves the hash of its meter file and its contract terms.
- **AI agent:** AI SDK tools limit the model to the implemented operations. Gemini was used for the recorded agent runs.
- **Payments:** the payment rail calls PayPal sandbox APIs.

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

Provider fees materially affect small groups. With our modelled June data and stated fee assumptions, a 1 ct/kWh operator fee leaves €0.19 after PayPal fees only. A 2 ct scenario leaves €8.22 while reducing producer compensation. Neither is profit. The 1 ct/kWh figure is a demo assumption from a secondary source, not our pricing, and these scenarios are not a revenue model.

## What's next

Three things are not yet validated:

1. **Problem and customer:** do real operators see these disputes, and which ones cost them time? We need real exception cases from an energy-sharing operator. No operator has agreed to a pilot yet.
2. **Product:** compared with their current process, does the desk reduce working time, missed issues or wrong proposals? A pilot must measure staff working time separately from time spent waiting for metering or grid operators.
3. **Business:** does the saving exceed the cost of using it, and will operators pay? Our pricing hypothesis is a monthly subscription paid by operators; it is not validated.

**Before production use:**
- operator login, roles and per-organisation data separation
- a persistent ledger with backups
- recovery and monitoring for failed payments
- real meter data, including corrections, and corrected statements
- independent evaluation of the AI agent's proposals
- the payment-services and PayPal approvals above

## Testing instructions

No credentials or installation needed: **https://solar-coop.onrender.com/coop/demo**. This is the Render free tier, so the first request after inactivity can take about a minute. Each visitor gets their own offline copy. There is no PayPal call and no live AI call. Data are fictional and cleared after 24 hours or on a restart.

1. Click **Start the demo**. Haus 7's message about its bill is already attached.
2. Read the **Bill check**: meter → share → bill → payment.
3. Under **Evidence received**, click **Use a fictional metering-operator reply**, then **Add manual evidence**.
4. Click **Prepare offline investigation**. Expected: **Saved real AI proposal · one recorded run**. If you prepare before adding the evidence, you get the template instead, because the input differs.
5. Write a note and click **Record review**, then **Record explanation sent**, then **Record customer confirmation**.

Expected: the dispute is closed, the timeline lists every step, and the payment still shows "Not sent · not paid". **Reset demo** starts over. The same flow runs locally with `npm ci` and `npm run dev:workbench` in `paypal-solar`, at `/coop?source=rehearsal`.

Other pages:
- `http://127.0.0.1:3007/coop?source=evidence`: archived sandbox evidence (read-only, 10 of 10 matched).
- `http://127.0.0.1:3007/coop/exceptions?source=holdout`: saved AI agent run on twelve team-authored synthetic cases.

These paths make no live PayPal or model calls. A live run needs the judge's own PayPal sandbox app and Gemini API key in `.env.local`; the variable names are in `.env.example`, and setup is in `docs/coop-settlement.md`.

## Submission links

- Hosted demo: https://solar-coop.onrender.com/coop/demo
- Video: https://youtu.be/hojPv-chuG8
- Source: https://github.com/gracelee087/solar-coop

The local judge guide is `docs/JUDGE_GUIDE.md`.
