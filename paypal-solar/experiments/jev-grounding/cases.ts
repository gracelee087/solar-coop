// Grounding-review experiment, separate from the product (nothing in src/ imports this folder).
// Case X04 of the synthetic exception cases: PayPal shows the bill unpaid, the customer says they paid by bank transfer.
// The claims and the expected answers below were written by the developer BEFORE any Jev result and must not be
// changed to match results; a disagreement is a finding to report.

import { EXCEPTION_CASES } from "../../src/lib/coop/exception-cases";
import { caseView } from "../../src/lib/coop/exceptions";

/** Provisional experiment threshold, taken from TypeSafe's citation-check cookbook (AUTO_ACCEPT = 0.8); fixed before results. */
export const CONFIDENCE_THRESHOLD = 0.8;

export interface Item {
  id: string;
  text: string;
  /** fact = written by code from the case data; customer_message = an unverified claim by a person. */
  kind: "fact" | "customer_message";
}

export interface Claim {
  id: string;
  proposalId: string;
  kind: "fact_claim" | "action_recommendation";
  text: string;
  cited: string[];
  /** Human answer key, frozen before any Jev run. */
  expected: { support?: "supports" | "says_nothing" | "contradicts"; claimAsFact?: boolean; actionFit?: "consistent" | "premature" | "unrelated" };
}

export interface Proposal {
  id: string;
  label: string;
  action: string;
  reason: string;
  unverified: string[];
  expected: { missingUnverified: boolean };
}

const x04 = caseView(EXCEPTION_CASES.find((x) => x.id === "X04")!);

/** Facts get ids F1…, customer messages keep the N1… ids the desk shows. */
export const ITEMS: Item[] = [
  ...x04.facts.map((text, i) => ({ id: `F${i + 1}`, text, kind: "fact" as const })),
  ...x04.notes.map((n) => ({ id: n.id, text: n.text, kind: "customer_message" as const })),
];
const fact = (prefix: string) => ITEMS.find((i) => i.kind === "fact" && i.text.startsWith(prefix))!.id;
const PAYPAL_NOT_CONFIRMED = fact("Payment confirmed by PayPal");
const BANK_NOT_CONNECTED = fact("Bank account check");

export const PROPOSALS: Proposal[] = [
  {
    id: "P-good",
    label: "Correct explanation",
    action: "escalate",
    reason:
      "The customer says they paid by bank transfer on 14 July. PayPal shows no confirmed payment. Hold reminders and check the bank statement before any further step.",
    unverified: ["Bank transfer of 14 July, reference ST-202606-H07, not yet found on the bank statement"],
    expected: { missingUnverified: false },
  },
  {
    id: "P-bad",
    label: "Wrong explanation (passes the code check apart from the placeholder guard)",
    action: "escalate",
    reason: "Bank transfer is confirmed. No further verification is needed.",
    unverified: ["None"],
    expected: { missingUnverified: true },
  },
];

export const CLAIMS: Claim[] = [
  { id: "A", proposalId: "P-good", kind: "fact_claim", text: "The customer says they paid by bank transfer on 14 July.", cited: ["N1"],
    expected: { support: "supports", claimAsFact: false } },
  { id: "B", proposalId: "P-bad", kind: "fact_claim", text: "The bank transfer has been confirmed.", cited: ["N1"],
    expected: { support: "says_nothing", claimAsFact: true } },
  { id: "C", proposalId: "P-good", kind: "fact_claim", text: "PayPal shows no confirmed payment.", cited: [PAYPAL_NOT_CONFIRMED],
    expected: { support: "supports", claimAsFact: false } },
  { id: "D", proposalId: "P-good", kind: "action_recommendation", text: "Hold reminders and check the bank statement before any further step.",
    cited: ["N1", PAYPAL_NOT_CONFIRMED, BANK_NOT_CONNECTED], expected: { actionFit: "consistent" } },
  { id: "E", proposalId: "P-bad", kind: "action_recommendation", text: "No further verification is needed.", cited: ["N1"],
    expected: { actionFit: "premature" } },
  { id: "F", proposalId: "P-bad", kind: "fact_claim", text: "PayPal confirms the payment.", cited: [PAYPAL_NOT_CONFIRMED],
    expected: { support: "contradicts", claimAsFact: false } },
];
