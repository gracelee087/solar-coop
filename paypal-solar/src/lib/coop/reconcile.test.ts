import { describe, expect, it } from "vitest";
import { PaymentLedger, type PaymentDraft } from "./ledger";
import { reconcileBill, reconcilePayout, type InvoiceObservation, type PayoutObservation } from "./reconcile";
import { sampleCoop } from "./sample-group";

const at = new Date("2026-10-14T10:00:00Z");
const bill = { id: "bill-ST-202606-H04", kind: "bill", statementId: "ST-202606-H04", amountCents: 1236 } as PaymentDraft;
const payout = { id: "payout-PO-202606-H03", kind: "payout", statementId: "PO-202606-H03", amountCents: 2253 } as PaymentDraft;

const invoice = (over: Partial<InvoiceObservation> = {}): InvoiceObservation => ({
  status: "PAID",
  detail: { invoice_number: "ST-202606-H04", currency_code: "EUR" },
  amount: { currency_code: "EUR", value: "12.36" },
  due_amount: { value: "0.00" },
  payments: { paid_amount: { value: "12.36", currency_code: "EUR" } },
  ...over,
});
const batch = (status: string, value = "22.53", ref = "PO-202606-H03"): PayoutObservation => ({
  batch_header: { batch_status: "SUCCESS" },
  items: [{ transaction_status: status, payout_item: { amount: { value, currency: "EUR" }, sender_item_id: ref } }],
});

describe("bill reconciliation", () => {
  it("matches only a full PayPal payment of the settlement amount", () => {
    expect(reconcileBill(bill, invoice(), at)).toMatchObject({ status: "matched", reason: "paid 12.36 € = settlement 12.36 €" });
  });

  it("keeps sent invoices pending and flags everything else", () => {
    expect(reconcileBill(bill, invoice({ status: "SENT", payments: undefined }), at).status).toBe("pending");
    expect(reconcileBill(bill, invoice({ status: "MARKED_AS_PAID" }), at).status).toBe("mismatch");
    expect(reconcileBill(bill, invoice({ status: "PARTIALLY_PAID" }), at).status).toBe("mismatch");
    expect(reconcileBill(bill, invoice({ payments: { paid_amount: { value: "12.00" } } }), at).reason).toMatch(/paid 12.00/);
    expect(reconcileBill(bill, invoice({ amount: { currency_code: "EUR", value: "13.36" } }), at).reason).toMatch(/invoice total/);
    expect(reconcileBill(bill, invoice({ detail: { invoice_number: "ST-202606-H05", currency_code: "EUR" } }), at).status).toBe("mismatch");
  });
});

describe("payout reconciliation", () => {
  it("matches a successful payout item of the settlement amount", () => {
    expect(reconcilePayout(payout, batch("SUCCESS"), at)).toMatchObject({ status: "matched" });
  });

  it("keeps pending and unclaimed payouts open and flags wrong amounts or failures", () => {
    expect(reconcilePayout(payout, batch("PENDING"), at).status).toBe("pending");
    expect(reconcilePayout(payout, batch("UNCLAIMED"), at).status).toBe("pending");
    expect(reconcilePayout(payout, batch("FAILED"), at).status).toBe("mismatch");
    expect(reconcilePayout(payout, batch("SUCCESS", "22.00"), at).status).toBe("mismatch");
    expect(reconcilePayout(payout, batch("SUCCESS", "22.53", "PO-202606-H01"), at).status).toBe("mismatch");
    expect(reconcilePayout(payout, { items: [] }, at).status).toBe("mismatch");
  });
});

it("stores reconciliation only on executed drafts", async () => {
  const l = new PaymentLedger(sampleCoop.participants, { name: "f", execute: async () => ({ externalId: "INV", status: "SENT" }) });
  const id = l.draft({ kind: "bill", participantId: "H04", period: "2026-06", statementId: "ST-202606-H04", amountCents: 1236 }).id;
  const rec = reconcileBill(l.get(id), invoice(), at);
  expect(() => l.recordReconciliation(id, rec)).toThrow(/expected executed/);
  l.requestApproval(id);
  l.approve(id, "operator");
  await l.execute(id);
  expect(l.recordReconciliation(id, rec).reconciliation?.status).toBe("matched");
  expect(l.get(id).amountCents).toBe(1236);
});
