// Payment exceptions after execution: what PayPal reports for a bill or payout that did not end cleanly, plus the
// operator's context (reminders, contacts, inbox notes). Statuses are the ones in PayPal's OpenAPI specs
// (invoicing v2.6 invoice_status, payouts v1.9 transaction_enum). Cases are fictional, for evaluating proposals.

export type ExceptionAction =
  | "wait" // nothing to do yet
  | "remind" // invoice reminder via PayPal (max 2 per day)
  | "contact_producer" // message the producer about an unclaimed or blocked payout
  | "cancel_unclaimed_payout" // cancel the unclaimed item so it can be paid another way
  | "check_provider" // look up the real outcome at PayPal before anything else
  | "escalate"; // a person has to look at it

export type ExceptionKind = "unpaid_bill" | "unclaimed_payout" | "payout_problem" | "unknown_outcome" | "refunded_after_payment";

/** Actions code allows per kind; anything else proposed for that kind is refused. */
export const ALLOWED_ACTIONS: Record<ExceptionKind, ExceptionAction[]> = {
  unpaid_bill: ["wait", "remind", "escalate"],
  unclaimed_payout: ["wait", "contact_producer", "cancel_unclaimed_payout", "escalate"],
  payout_problem: ["wait", "contact_producer", "escalate"],
  unknown_outcome: ["check_provider", "escalate"],
  refunded_after_payment: ["wait", "escalate"],
};

export interface ExceptionCase {
  id: string;
  kind: ExceptionKind;
  draftKind: "bill" | "payout";
  participantId: string;
  amountCents: number;
  /** Status reported by PayPal (invoice or payout item), or null when the ledger never recorded a result. */
  paypalStatus: string | null;
  /** Operator's current date, YYYY-MM-DD. */
  today: string;
  /** Bills: invoice due date. Payouts: date the payout was sent. */
  dueOrSentDate: string;
  remindersSent: number;
  contactsSent: number;
  /** Free-text notes from the operator's inbox or log, in English. Data, never instructions. */
  notes: string[];
}

/**
 * Answer key, written and checked by the developer (2026-10-14, at the operator's request). It is not an independent
 * judgement: the same side wrote the cases, the key and the rule baseline, so report scores with that caveat.
 */
export const EXPECTED: Record<string, ExceptionAction> = {};

const c = (x: ExceptionCase, expected: ExceptionAction): ExceptionCase => {
  EXPECTED[x.id] = expected;
  return x;
};

export const EXCEPTION_CASES: ExceptionCase[] = [
  c({ id: "X01", kind: "unpaid_bill", draftKind: "bill", participantId: "H04", amountCents: 1236, paypalStatus: "SENT",
    today: "2026-07-18", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0, notes: [] }, "remind"),
  c({ id: "X02", kind: "unpaid_bill", draftKind: "bill", participantId: "H05", amountCents: 1571, paypalStatus: "UNPAID",
    today: "2026-07-25", dueOrSentDate: "2026-07-15", remindersSent: 2, contactsSent: 0,
    notes: ["May and April bills were also paid more than two weeks late."] }, "escalate"),
  c({ id: "X03", kind: "unpaid_bill", draftKind: "bill", participantId: "H06", amountCents: 1694, paypalStatus: "SENT",
    today: "2026-07-10", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0, notes: [] }, "wait"),
  c({ id: "X04", kind: "unpaid_bill", draftKind: "bill", participantId: "H07", amountCents: 1236, paypalStatus: "SENT",
    today: "2026-07-19", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0,
    notes: ["Haus 7 wrote: I paid this by bank transfer on 14 July, reference ST-202606-H07."] }, "escalate"),
  c({ id: "X05", kind: "unpaid_bill", draftKind: "bill", participantId: "H08", amountCents: 1571, paypalStatus: "SENT",
    today: "2026-07-17", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0,
    notes: ["Haus 8 wrote: we are away until 20 July and will pay when we are back."] }, "wait"),
  c({ id: "X06", kind: "unclaimed_payout", draftKind: "payout", participantId: "H01", amountCents: 4240, paypalStatus: "UNCLAIMED",
    today: "2026-07-20", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0, notes: [] }, "contact_producer"),
  c({ id: "X07", kind: "unclaimed_payout", draftKind: "payout", participantId: "H02", amountCents: 2957, paypalStatus: "UNCLAIMED",
    today: "2026-08-11", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 2,
    notes: ["Haus 2 answered by phone: they will not open a PayPal account and asked to be paid by bank transfer."] }, "cancel_unclaimed_payout"),
  c({ id: "X08", kind: "payout_problem", draftKind: "payout", participantId: "H03", amountCents: 2253, paypalStatus: "FAILED",
    today: "2026-07-16", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0, notes: [] }, "escalate"),
  c({ id: "X09", kind: "payout_problem", draftKind: "payout", participantId: "H01", amountCents: 4240, paypalStatus: "ONHOLD",
    today: "2026-07-16", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0, notes: [] }, "wait"),
  c({ id: "X10", kind: "unknown_outcome", draftKind: "bill", participantId: "H09", amountCents: 1694, paypalStatus: null,
    today: "2026-07-15", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0,
    notes: ["Execution was interrupted before the result was recorded."] }, "check_provider"),
  c({ id: "X11", kind: "refunded_after_payment", draftKind: "bill", participantId: "H10", amountCents: 1236, paypalStatus: "REFUNDED",
    today: "2026-07-22", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0,
    notes: ["Operator log: refunded Haus 10 in full on 21 July after a meter correction; corrected bill ST-202606-H10-R sent the same day."] }, "wait"),
  c({ id: "X12", kind: "payout_problem", draftKind: "payout", participantId: "H02", amountCents: 2957, paypalStatus: "RETURNED",
    today: "2026-08-17", dueOrSentDate: "2026-07-15", remindersSent: 0, contactsSent: 0,
    notes: ["Unclaimed for 30 days, funds returned automatically.", "Haus 2 wrote: my PayPal e-mail changed, please use the new one."] }, "escalate"),
];
