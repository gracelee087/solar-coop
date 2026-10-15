import type { BillChain, PaymentState } from "./billing-check";
import type { DeskItem, DeskSource, DeskView } from "./desk";

/** fact = computed or observed by the system; claim = customer message; manual = entered by an operator, not verified by the system. */
export interface Evidence { id: string; kind: "fact" | "claim" | "manual"; text: string }
export type EvidenceSource = "metering_operator" | "grid_operator" | "paypal" | "customer" | "internal";
export const EVIDENCE_SOURCES: Record<EvidenceSource, string> = {
  metering_operator: "Metering operator",
  grid_operator: "Grid operator",
  paypal: "PayPal (entered by hand)",
  customer: "Customer document",
  internal: "Internal record",
};
export interface Investigation {
  reason: string;
  evidence: string[];
  unverified: string[];
  checks: string[];
  replyDraft: string;
}
/** What the customer disputes: the billed amount, the metered energy, or a payment they say they made. */
export type DisputeTopic = "amount" | "meter" | "already_paid";
/**
 * Status of the customer's dispute about the bill, separate from the payment status. Waiting for an external check
 * and a needed correction stay open; a closed case says whether the customer confirmed or only the operator reviewed.
 */
export type CaseStatus =
  | "open"
  | "investigating"
  | "waiting_external"
  | "correction_needed"
  | "explained_awaiting_reply"
  | "closed_operator_reviewed"
  | "closed_customer_confirmed";
export const CLOSED_STATUSES: readonly CaseStatus[] = ["closed_operator_reviewed", "closed_customer_confirmed"];
export interface WorkCase {
  topic?: DisputeTopic;
  messages: { id: string; text: string; by: string; at: string }[];
  /** Evidence an operator entered by hand. Never treated as a system check, even if it names PayPal or a transaction id. */
  evidence?: { id: string; source: EvidenceSource; reference?: string; text: string; by: string; at: string }[];
  status: CaseStatus;
  proposal?: Investigation & { source: "template" | "agent"; model?: string; basis: string; at: string; /** Set when a recorded run was reused for an identical input. */ saved?: { ranAt: string } };
  history: { event: string; by: string; at: string; detail: string }[];
}
export interface WorkItem extends DeskItem {
  statementId: string;
  version: string;
  basis: string;
  evidence: Evidence[];
  work: WorkCase;
  proposalStale: boolean;
  /** Link-by-link check of a bill (bills only). */
  chain?: BillChain;
  payment: PaymentState;
}
export interface WorkbenchView {
  desk: DeskView;
  items: WorkItem[];
  closingNotes: string[];
  counts: { review: number; matched: number; unmatched: number; openCases: number; readyToClose: boolean };
}
export interface WorkTarget { period: string; source: DeskSource; draftId: string }
