import { describe, expect, it } from "vitest";
import { buildCreateInvoiceArgs, decideExisting, settlementKey, verifyInvoice, type InvoiceInput } from "./invoice";
import type { PayPalInvoice } from "./paypal-api";

const input: InvoiceInput = {
  producer: { name: "Haus 12", email: "seller@business.example.com" },
  consumer: { name: "Haus 10", email: "buyer@personal.example.com" },
  period: "2026-06",
  sharedKWh: 186.3,
  priceCt: 12.9,
  amountCents: 2403,
  invoiceNumber: "ES-202606-H10-1",
  invoiceDate: "2026-07-01",
};

describe("buildCreateInvoiceArgs", () => {
  it("bills the exact total as one line with two-decimal amounts", () => {
    const a = buildCreateInvoiceArgs(input);
    expect(a.items).toHaveLength(1);
    expect(a.items[0].unit_amount).toEqual({ currency_code: "EUR", value: "24.03" });
    expect(a.items[0].description).toContain("186.30 kWh × 12.90 ct/kWh");
    expect(a.note).toContain("§ 19 UStG");
  });
});

describe("verifyInvoice", () => {
  const good: PayPalInvoice = {
    id: "INV2-X",
    status: "SENT",
    detail: { invoice_number: "ES-202606-H10-1", currency_code: "EUR" },
    primary_recipients: [{ billing_info: { email_address: "buyer@personal.example.com" } }],
    amount: { currency_code: "EUR", value: "24.03" },
  };

  it("accepts a matching invoice", () => {
    expect(verifyInvoice(good, input)).toEqual([]);
  });

  it("flags a wrong amount and recipient", () => {
    const bad = { ...good, amount: { currency_code: "EUR", value: "240.30" }, primary_recipients: [] };
    expect(verifyInvoice(bad, input)).toHaveLength(2);
  });

  it("flags a wrong currency", () => {
    expect(verifyInvoice({ ...good, amount: { currency_code: "USD", value: "24.03" } }, input)).toEqual(["currency USD ≠ EUR"]);
  });
});

describe("settlementKey", () => {
  it("is fixed per period, producer and neighbour", () => {
    expect(settlementKey("2026-06", "p1", "h1")).toBe("ES-202606-P1-H1");
    expect(settlementKey("2026-06", "p1", "h1")).toBe(settlementKey("2026-06", "p1", "h1"));
    expect(settlementKey("2026-07", "p1", "h1")).not.toBe(settlementKey("2026-06", "p1", "h1"));
  });
});

describe("decideExisting", () => {
  const sent: PayPalInvoice = {
    id: "INV2-X",
    status: "SENT",
    detail: { invoice_number: "ES-202606-H10-1", currency_code: "EUR" },
    primary_recipients: [{ billing_info: { email_address: "buyer@personal.example.com" } }],
    amount: { currency_code: "EUR", value: "24.03" },
  };

  it("reuses a matching invoice that was already sent or paid", () => {
    expect(decideExisting(sent, input)).toEqual({ action: "reuse" });
    expect(decideExisting({ ...sent, status: "PAID" }, input)).toEqual({ action: "reuse" });
  });

  it("sends a matching draft left by an interrupted run", () => {
    expect(decideExisting({ ...sent, status: "DRAFT" }, input)).toEqual({ action: "send" });
  });

  it("never sends a draft whose amount or recipient differ from the current calculation", () => {
    const d = decideExisting({ ...sent, status: "DRAFT", amount: { currency_code: "EUR", value: "25.00" } }, input);
    expect(d.action).toBe("conflict");
    const r = decideExisting({ ...sent, status: "DRAFT", primary_recipients: [] }, input);
    expect(r.action).toBe("conflict");
  });

  it("stops on a cancelled invoice instead of creating a new one", () => {
    expect(decideExisting({ ...sent, status: "CANCELLED" }, input)).toEqual({
      action: "conflict",
      problems: ["existing invoice is CANCELLED"],
    });
  });
});
