# Judge walkthrough

This walkthrough requires no credentials, provider account or external API call after dependencies are installed. It uses modelled household data and archived observations. There is no test-account password to obtain.

## 1. Run the application

From the repository root: `cd paypal-solar`, `npm ci`, then `npm run dev:workbench`. Open http://127.0.0.1:3007/coop?source=evidence. Use Node.js 22.

On a fresh checkout, `/` redirects to the desk and displays bundled read-only evidence. Existing local runs do not affect the explicit `source=evidence` route.

## 2. Inspect the payment evidence

Expected: seven consumer bills totalling €102.38, three producer payouts totalling €94.50 and ten matched saved observations. Select a bill, then a producer payout, and inspect the amount, approval and provider observation.

The banner says archived sandbox evidence and read-only. The displayed references are anonymized. Refresh and write actions are disabled; opening the page performs no PayPal lookup. This shows a recorded run, not a new settlement or independent verification of current provider state.

## 3. Inspect the saved real-model output

Open `/coop/exceptions?source=holdout`. Locate **Y11** and compare the code-written facts, customer claim and proposal. Click evidence tags to inspect their text. Confirm that a customer payment claim is not treated as proof of receipt.

Expected: 12/12 accepted actions for the saved model run and 8/12 for fixed rules. This is one synthetic evaluation authored by the same team as the prompt; it is not an unseen independent benchmark. Read-only review is intentional. Some explanations are incomplete and evidence references have known limitations.

## 4. Try the operator interaction separately

Open `/coop?source=rehearsal`. On a fresh installation, click **Start offline June rehearsal**. Existing rehearsals are preserved. Select **Haus 7**, enter a reviewer name, and attach this fictional message:

> I paid by bank transfer yesterday. Please check before sending another reminder.

Prepare the offline investigation, inspect the facts/claim tags and unsent reply, then record a review note such as “Check the bank record and allocation before resolving.”

Expected: review becomes awaiting evidence. Payment remains unconfirmed. No reply, reminder, model request or payment is sent. The checklist is explicitly a template, not an AI result. Resolving an unreconciled payment is not offered: the button stays disabled, and the API refuses it with 409.

You can approve a pending rehearsal draft with a reviewer name; expected status is approved but not sent. Execution is a separate CLI operation, deliberately outside this key-free guide. This rehearsal is independent from the archived sandbox evidence.

## 5. Recalculate and re-score

Run `npm test -- src/lib/coop/submission-evidence.test.ts`. It recalculates the archived statement amounts from the committed meter CSV, re-scores saved AI actions against the accepted answers, and confirms that archive loading creates no mutable payment ledger. No model or payment request is made.

For the full test suite, first run `npm run fetch-data:h25`, as explained in the README. Standard checks and their current verification status are in `VERIFICATION.md`.

## What these screens do not establish

No live bank connection, real household meter integration, production payment eligibility, measured human time savings or perfect model reasoning is claimed. Public production mode is read-only unless separately authenticated; the interactive walkthrough uses local development mode. The earlier `/energy`, `/demo` and correction prototypes are not required to judge the main operator flow.
