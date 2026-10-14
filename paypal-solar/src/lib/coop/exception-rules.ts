import type { ExceptionAction, ExceptionCase } from "./exception-cases";

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * Rule baseline: a fixed mapping from kind, PayPal status, dates and counters to an action. It never reads the
 * free-text notes. The agent's proposals are compared against this.
 */
export function ruleAction(x: ExceptionCase): ExceptionAction {
  switch (x.kind) {
    case "unpaid_bill":
      if (days(x.dueOrSentDate, x.today) <= 0) return "wait";
      return x.remindersSent >= 2 ? "escalate" : "remind";
    case "unclaimed_payout":
      return days(x.dueOrSentDate, x.today) >= 25 ? "cancel_unclaimed_payout" : "contact_producer";
    case "payout_problem":
      return x.paypalStatus === "ONHOLD" ? "wait" : "escalate";
    case "unknown_outcome":
      return "check_provider";
    case "refunded_after_payment":
      return "escalate";
  }
}

/** Share of cases where `propose` matches the answer key. */
export function score(cases: ExceptionCase[], key: Record<string, ExceptionAction>, propose: (x: ExceptionCase) => ExceptionAction) {
  const misses = cases.filter((x) => propose(x) !== key[x.id]).map((x) => x.id);
  return { correct: cases.length - misses.length, total: cases.length, misses };
}

/** Like `score`, for answer keys that accept more than one action per case. */
export function scoreAccepted(cases: ExceptionCase[], key: Record<string, ExceptionAction[]>, propose: (x: ExceptionCase) => ExceptionAction) {
  const misses = cases.filter((x) => !key[x.id].includes(propose(x))).map((x) => x.id);
  return { correct: cases.length - misses.length, total: cases.length, misses };
}
