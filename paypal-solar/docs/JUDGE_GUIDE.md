# Judge walkthrough

This walkthrough requires no credentials, provider account or external API call after dependencies are installed. It uses modelled household data and archived observations. There is no test-account password to obtain.

## 1. Run the application

Hosted: https://solar-coop.onrender.com/coop/demo runs the Haus 7 dispute (step 4) for each visitor separately, and https://solar-coop.onrender.com/coop?source=evidence shows steps 2 and 3. The first request after inactivity can take about a minute (Render free tier). The full rehearsal needs a local run:

From the repository root: `cd paypal-solar`, `npm ci`, then `npm run dev:workbench`. Open http://127.0.0.1:3007/coop?source=evidence. Use Node.js 22.

On a fresh checkout, `/` redirects to the desk and displays bundled read-only evidence. Existing local runs do not affect the explicit `source=evidence` route.

## 2. Inspect the payment evidence

Expected: seven consumer bills totalling €102.38, three producer payouts totalling €94.50 and ten matched saved observations. Select a bill, then a producer payout, and inspect the amount, approval and provider observation.

The banner says archived sandbox evidence and read-only. The displayed references are anonymized. Refresh and write actions are disabled; opening the page performs no PayPal lookup. This shows a recorded run, not a new settlement or independent verification of current provider state.

## 3. Inspect the saved real-model output

Open `/coop/exceptions?source=holdout`. Locate **Y11** and compare the code-written facts, customer claim and proposal. Click evidence tags to inspect their text. Confirm that a customer payment claim is not treated as proof of receipt.

Expected: 12/12 accepted actions for the saved model run and 8/12 for fixed rules. This is one synthetic evaluation authored by the same team as the prompt; it is not an unseen independent benchmark. Read-only review is intentional. Some explanations are incomplete and evidence references have known limitations.

## 4. Follow one customer dispute end to end

Fastest path, no installation: https://solar-coop.onrender.com/coop/demo (or `/coop/demo` locally). Click **Start the demo** to inspect the month's drafts and archived PayPal results, then follow the separate fictional Haus 7 case. There is one step per screen, with **Start over** at any time. Adding the fictional metering-operator reply before **Load saved AI proposal** loads the proposal recorded once on exactly that input (`experiments/h07-dispute`, with criteria and judgement); it makes no live model call. The final screen says **Demo complete: the dispute is closed**, while the rehearsal payment remains unpaid. No new month is settled. The steps below use the full local operator rehearsal instead.

Open `/coop?source=rehearsal`. On a fresh installation, click **Start offline June rehearsal**. Existing rehearsals are preserved. Select **Haus 7** and enter a reviewer name.

1. Click **Use a fictional meter question** (topic: metered energy) and **Attach unverified message**.
2. Read **Bill check · meter → share → bill → payment**. Expected: 192.6 kWh metered = 95.1 kWh shared solar (billed, 13.00 ct, €12.36) + 97.5 kWh residual from the household's own supplier; meter, allocation and bill links show MATCH; payment shows OPEN (not sent).
3. **Prepare offline investigation**. Inspect the evidence tags (C1–C3 bill check, N1 message) and the unsent reply draft, which uses the computed numbers. Record a review note.
4. Under **Evidence received**, click **Use a fictional metering-operator reply** and **Add manual evidence**. Expected: the entry is labelled manual, not verified by the system, and the investigation is out of date. Prepare and review again.
5. **Record explanation sent**, then **Record customer confirmation** (or **Close without customer confirmation**).

Expected: the dispute is closed and the **Case timeline** lists every step with calendar days (not working time). The payment still reads "Not sent · not paid": closing a dispute never marks a bill paid. No reply, model request or payment is sent. Each proposal is labelled either as a code template (not AI) or as the saved real AI proposal, which is used only when the case equals the recorded input.

To see the payment-claim path, select another bill, choose **Says already paid**, and follow the same steps. Expected: an explanation is not offered for a payment claim, and closing is refused with 409 until the payment is reconciled. **Wait for external answer** and **Correction needed** keep any case open.

You can approve a pending rehearsal draft with a reviewer name; expected status is approved but not sent. Execution is a separate CLI operation, deliberately outside this key-free guide. This rehearsal is independent from the archived sandbox evidence.

## 5. Recalculate and re-score

Run `npm test -- src/lib/coop/submission-evidence.test.ts`. It recalculates the archived statement amounts from the committed meter CSV, re-scores saved AI actions against the accepted answers, and confirms that archive loading creates no mutable payment ledger. No model or payment request is made.

For the full test suite, first run `npm run fetch-data:h25`, as explained in the README. Standard checks and their current verification status are in `VERIFICATION.md`.

## What these screens do not establish

No live bank connection, real household meter integration, production payment eligibility, measured human time savings or perfect model reasoning is claimed. The public operator desk is read-only; `/coop/demo` allows only isolated fictional case actions, with no payment approval, execution or live model calls. The full operator rehearsal runs locally. The earlier `/energy`, `/demo` and correction prototypes are not required to judge the main operator flow.
