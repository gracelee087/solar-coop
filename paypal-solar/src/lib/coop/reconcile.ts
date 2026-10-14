import type { PaymentDraft } from "./ledger";

export type ReconcileStatus = "matched" | "pending" | "mismatch";

export interface Reconciliation {
  status: ReconcileStatus;
  checkedAt: string;
  /** What PayPal reported, kept as observed. */
  observed: { externalStatus: string; amount: string | null; reference: string | null };
  reason: string;
}

const eur = (cents: number) => (cents / 100).toFixed(2);

/** Subset of a PayPal Invoicing v2 invoice used for reconciliation. */
export interface InvoiceObservation {
  status: string;
  detail: { invoice_number?: string; currency_code: string };
  amount: { currency_code: string; value: string };
  due_amount?: { value: string };
  payments?: { paid_amount?: { value: string; currency_code?: string } };
}

/**
 * A bill matches only when PayPal reports PAID, the paid amount equals the settlement amount in EUR, nothing is
 * due and the invoice number is the statement id. MARKED_AS_PAID (recorded outside PayPal) and refunds never count.
 */
export function reconcileBill(d: PaymentDraft, inv: InvoiceObservation, at: Date): Reconciliation {
  const want = eur(d.amountCents);
  const paid = inv.payments?.paid_amount?.value ?? null;
  const observed = { externalStatus: inv.status, amount: paid, reference: inv.detail.invoice_number ?? null };
  const r = (status: ReconcileStatus, reason: string): Reconciliation => ({ status, checkedAt: at.toISOString(), observed, reason });
  if (inv.detail.invoice_number !== d.statementId) return r("mismatch", `invoice number ${inv.detail.invoice_number} ≠ ${d.statementId}`);
  if (inv.detail.currency_code !== "EUR" || inv.amount.currency_code !== "EUR") return r("mismatch", "currency is not EUR");
  if (inv.amount.value !== want) return r("mismatch", `invoice total ${inv.amount.value} € ≠ settlement ${want} €`);
  if (["SENT", "UNPAID", "PAYMENT_PENDING", "SCHEDULED"].includes(inv.status)) return r("pending", "waiting for the customer's payment");
  if (inv.status !== "PAID") return r("mismatch", `status ${inv.status} is not a PayPal payment of the full amount`);
  if (paid !== want) return r("mismatch", `paid ${paid ?? "nothing"} € ≠ settlement ${want} €`);
  if (inv.due_amount && Number(inv.due_amount.value) !== 0) return r("mismatch", `still due ${inv.due_amount.value} €`);
  return r("matched", `paid ${paid} € = settlement ${want} €`);
}

/** Subset of `GET /v1/payments/payouts/{id}`. */
export interface PayoutObservation {
  batch_header?: { batch_status?: string };
  items?: { transaction_status?: string; payout_item?: { amount?: { value: string; currency: string }; sender_item_id?: string } }[];
}

/** A payout matches when its single item succeeded with the settlement amount in EUR for this statement. */
export function reconcilePayout(d: PaymentDraft, batch: PayoutObservation, at: Date): Reconciliation {
  const want = eur(d.amountCents);
  const item = batch.items?.length === 1 ? batch.items[0] : undefined;
  const status = item?.transaction_status ?? batch.batch_header?.batch_status ?? "UNKNOWN";
  const observed = { externalStatus: status, amount: item?.payout_item?.amount?.value ?? null, reference: item?.payout_item?.sender_item_id ?? null };
  const r = (s: ReconcileStatus, reason: string): Reconciliation => ({ status: s, checkedAt: at.toISOString(), observed, reason });
  if (!item) return r("mismatch", `expected one payout item, got ${batch.items?.length ?? 0}`);
  if (observed.reference !== d.statementId) return r("mismatch", `payout reference ${observed.reference} ≠ ${d.statementId}`);
  if (item.payout_item?.amount?.currency !== "EUR" || observed.amount !== want) {
    return r("mismatch", `payout ${observed.amount} ${item.payout_item?.amount?.currency ?? ""} ≠ settlement ${want} €`);
  }
  if (["PENDING", "PROCESSING", "ONHOLD", "NEW"].includes(status)) return r("pending", `payout ${status.toLowerCase()}`);
  if (status === "UNCLAIMED") return r("pending", "recipient has not claimed the payout yet (returned after 30 days)");
  if (status !== "SUCCESS") return r("mismatch", `payout status ${status}`);
  return r("matched", `paid out ${observed.amount} € = settlement ${want} €`);
}
