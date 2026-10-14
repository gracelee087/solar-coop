// Real Gemini outputs from 2026-10-14 (fixtures/), each paired with a version that changes only what is under test.
// Expected answers were frozen before any Jev call and must not be changed to match results.
//   X run: prompt in fixtures/prompt-x-run.txt (no operator rules), cases EXCEPTION_CASES.
//   Y run: prompt in fixtures/prompt-y-run.txt (operator rules), held-out cases written before that prompt.
// The two runs used different cases and prompts; their scores are not comparable.

import { EXCEPTION_CASES } from "../../src/lib/coop/exception-cases";
import { HOLDOUT_CASES } from "../../src/lib/coop/exception-holdout";
import { caseView } from "../../src/lib/coop/exceptions";
import type { Item } from "./cases";
import xRun from "./fixtures/gemini-x-run-2026-10-14.json";
import yRun from "./fixtures/gemini-y-run-2026-10-14.json";

/** The operator rules the action is judged against (the Y-run prompt's rules, verbatim). */
export const OPERATOR_RULES = [
  "Unpaid bill not overdue yet: wait.",
  "A note says the bill was already paid (any way) but PayPal does not confirm a payment: never remind; escalate, and list the claimed payment as what a person has to confirm.",
  "A note disputes the amount: escalate.",
  "A note says the customer will pay by a date that has not passed yet: wait.",
  "Otherwise overdue: remind while fewer than 2 reminders were sent, escalate after 2.",
  "Unclaimed payouts: contact the producer first; the producer says they will claim it: wait; the producer asks to be paid another way: cancel_unclaimed_payout.",
  "Failed, returned or blocked payouts, and any request to change payment details: escalate. Payouts on hold: wait.",
  "Execution result unknown: check_provider. Refunded after payment: wait if an operator note explains the refund, otherwise escalate.",
];

export type Question = "case_support" | "cited_support" | "omits_relevant" | "rule_fit";

export interface Explanation {
  id: string;
  /** original = Gemini's output as saved; fixed = only the named part changed. */
  variant: "original" | "fixed";
  changed?: string;
  caseId: string;
  items: Item[];
  action: string;
  reason: string;
  cited: string[];
  unverified: string[];
  questions: Question[];
  /** Frozen before any Jev call. support questions: supports | says_nothing | contradicts; omits: true/false; rule_fit: consistent | inconsistent. */
  expected: Partial<Record<Question, string | boolean>>;
}

type Saved = { caseId: string; action: string; reason: string; evidence: string[]; unverified: string[] };

function itemsOf(caseId: string): Item[] {
  const x = [...EXCEPTION_CASES, ...HOLDOUT_CASES].find((c) => c.id === caseId)!;
  const v = caseView(x);
  return [
    ...v.facts.map((text, i) => ({ id: `F${i + 1}`, text, kind: "fact" as const })),
    ...v.notes.map((n) => ({ id: n.id, text: n.text, kind: "customer_message" as const })),
  ];
}

/** Turns the saved evidence (fact lines or note ids) into item ids; unknown evidence throws. */
function ids(items: Item[], evidence: string[]): string[] {
  return evidence.map((e) => {
    const hit = items.find((i) => i.id === e || i.text === e);
    if (!hit) throw new Error(`evidence "${e}" is not an item of the case`);
    return hit.id;
  });
}

function saved(run: { proposals: Saved[] }, caseId: string) {
  const p = run.proposals.find((q) => q.caseId === caseId)!;
  const items = itemsOf(caseId);
  return { items, p, cited: ids(items, p.evidence) };
}

/** Y01, Y04, Y07, Y11: right action, reason rests on a customer message that is not cited. Fixed = add that message id. */
function citationPair(caseId: string): Explanation[] {
  const { items, p, cited } = saved(yRun, caseId);
  const base = { caseId, items, action: p.action, reason: p.reason, unverified: p.unverified, questions: ["case_support", "cited_support"] as Question[] };
  return [
    { ...base, id: `${caseId}-original`, variant: "original", cited, expected: { case_support: "supports", cited_support: "says_nothing" } },
    { ...base, id: `${caseId}-fixed`, variant: "fixed", changed: "added the missing message id N1 to the cited evidence", cited: [...cited, "N1"],
      expected: { case_support: "supports", cited_support: "supports" } },
  ];
}

/** X04: reminder proposed while the claimed bank transfer is listed as unverified. Fixed = escalate, nothing else changed. */
function x04Pair(): Explanation[] {
  const { items, p, cited } = saved(xRun, "X04");
  const base = { caseId: "X04", items, reason: p.reason, cited, unverified: p.unverified, questions: ["rule_fit"] as Question[] };
  return [
    { ...base, id: "X04-original", variant: "original", action: p.action, expected: { rule_fit: "inconsistent" } },
    { ...base, id: "X04-fixed", variant: "fixed", changed: "action remind → escalate", action: "escalate", expected: { rule_fit: "consistent" } },
  ];
}

/**
 * Y12: "no operator note explains the refund" is true; the customer's double-charge message is left out. Omission,
 * not contradiction. Fixed = the reason also mentions the customer's unverified claim.
 */
function y12Pair(): Explanation[] {
  const { items, p, cited } = saved(yRun, "Y12");
  const base = { caseId: "Y12", items, action: p.action, cited, unverified: p.unverified, questions: ["case_support", "omits_relevant"] as Question[] };
  return [
    { ...base, id: "Y12-original", variant: "original", reason: p.reason, expected: { case_support: "supports", omits_relevant: true } },
    { ...base, id: "Y12-fixed", variant: "fixed", changed: "reason also states the customer's unverified double-charge claim",
      reason: `${p.reason} The customer says they asked PayPal for a refund because they were charged twice; this is not verified.`,
      expected: { case_support: "supports", omits_relevant: false } },
  ];
}

export const EXPLANATIONS: Explanation[] = [
  ...["Y01", "Y04", "Y07", "Y11"].flatMap(citationPair),
  ...x04Pair(),
  ...y12Pair(),
];
