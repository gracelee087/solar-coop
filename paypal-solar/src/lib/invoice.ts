import type { PayPalInvoice } from "./paypal-api";

export interface InvoiceInput {
  producer: { name: string; email: string };
  consumer: { name: string; email: string };
  /** Billing period, e.g. "2026-06". */
  period: string;
  sharedKWh: number;
  priceCt: number;
  amountCents: number;
  invoiceNumber: string;
  invoiceDate: string;
}

const eur = (c: number) => (c / 100).toFixed(2);

/** Final numeric check before any payment lookup, model call or invoice creation. */
export function checkInvoiceInput(i: InvoiceInput): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(i.sharedKWh) || i.sharedKWh <= 0) problems.push("shared kWh must be finite and positive");
  if (!Number.isFinite(i.priceCt) || i.priceCt <= 0) problems.push("price must be finite and positive");
  if (!Number.isSafeInteger(i.amountCents) || i.amountCents <= 0) problems.push("amount must be positive safe integer cents");
  return problems;
}

/**
 * What to do with a settlement before anything is looked up or created: zero shared energy with a zero amount
 * (and an otherwise valid price) is nothing to bill; any other failed check is invalid input.
 */
export function classifyInvoiceInput(i: InvoiceInput): { kind: "bill" } | { kind: "nothing_to_bill" } | { kind: "invalid"; problems: string[] } {
  if (i.sharedKWh === 0 && i.amountCents === 0) {
    const problems = checkInvoiceInput({ ...i, sharedKWh: 1, amountCents: 1 }); // only the remaining inputs
    return problems.length ? { kind: "invalid", problems } : { kind: "nothing_to_bill" };
  }
  const problems = checkInvoiceInput(i);
  return problems.length ? { kind: "invalid", problems } : { kind: "bill" };
}

/**
 * Arguments for the PayPal Agent Toolkit `create_invoice` tool.
 * PayPal unit amounts allow only two decimals, so ct/kWh prices (e.g. 0.129 €) cannot be a unit price:
 * the energy is one line item with the exact total, and kWh × price is spelled out in the description.
 */
export function buildCreateInvoiceArgs(i: InvoiceInput) {
  const problems = checkInvoiceInput(i);
  if (problems.length) throw new Error(`Invalid settlement: ${problems.join("; ")}`);
  return {
    currency_code: "EUR",
    invoice_number: i.invoiceNumber,
    invoice_date: i.invoiceDate,
    reference: `Energy Sharing § 42c EnWG, ${i.period}`,
    invoicer_business_name: i.producer.name,
    invoicer_email_address: i.producer.email,
    invoicer_country_code: "DE",
    primary_recipients: [{ billing_info: { email_address: i.consumer.email, business_name: i.consumer.name } }],
    items: [
      {
        name: `Shared solar electricity ${i.period}`,
        description: `${i.sharedKWh.toFixed(2)} kWh × ${i.priceCt.toFixed(2)} ct/kWh (allocated 15-minute values modelled from PVGIS and BDEW H25 profiles, not metered)`,
        quantity: "1",
        unit_amount: { currency_code: "EUR", value: eur(i.amountCents) },
      },
    ],
    note: [
      `Price agreed in your energy sharing contract (§ 42c (3) EnWG): ${i.priceCt.toFixed(2)} ct/kWh.`,
      "No VAT charged: small business under § 19 UStG.",
      "Grid fees, levies and electricity tax for this energy are billed separately by your electricity supplier.",
    ].join(" "),
  };
}

export type CreateInvoiceArgs = ReturnType<typeof buildCreateInvoiceArgs>;

/**
 * One invoice number per billing period, producer and neighbour, e.g. "ES-202606-P1-H1".
 * Re-running a settlement therefore finds the same invoice instead of billing twice.
 */
export function settlementKey(period: string, producerId: string, householdId: string): string {
  return `ES-${period.replace("-", "")}-${producerId}-${householdId}`.toUpperCase();
}

/** Statuses of an invoice that has already reached the neighbour. */
const DELIVERED = ["SENT", "UNPAID", "SCHEDULED", "PAYMENT_PENDING", "PARTIALLY_PAID", "PAID", "MARKED_AS_PAID"];

export type ExistingDecision =
  | { action: "reuse" } // already sent with the right content
  | { action: "send" } // draft with the right content (e.g. a run stopped after create)
  | { action: "conflict"; problems: string[] }; // never send automatically

/** What to do with an invoice that already carries this settlement's number. */
export function decideExisting(inv: PayPalInvoice, expected: InvoiceInput): ExistingDecision {
  const problems = verifyInvoice(inv, expected);
  if (problems.length) return { action: "conflict", problems };
  if (inv.status === "DRAFT") return { action: "send" };
  if (DELIVERED.includes(inv.status)) return { action: "reuse" };
  return { action: "conflict", problems: [`existing invoice is ${inv.status}`] };
}

/** Compare what PayPal holds with what we intended to bill. Returns a list of problems (empty = OK). */
export function verifyInvoice(inv: PayPalInvoice, expected: InvoiceInput): string[] {
  const problems: string[] = [];
  if (inv.amount.currency_code !== "EUR") problems.push(`currency ${inv.amount.currency_code} ≠ EUR`);
  if (inv.amount.value !== eur(expected.amountCents)) problems.push(`amount ${inv.amount.value} ≠ ${eur(expected.amountCents)}`);
  const email = inv.primary_recipients?.[0]?.billing_info?.email_address;
  if (email !== expected.consumer.email) problems.push(`recipient ${email} ≠ ${expected.consumer.email}`);
  if (inv.detail.invoice_number !== expected.invoiceNumber) {
    problems.push(`invoice number ${inv.detail.invoice_number} ≠ ${expected.invoiceNumber}`);
  }
  return problems;
}
