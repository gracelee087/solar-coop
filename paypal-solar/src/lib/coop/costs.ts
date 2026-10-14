import { illustrativePayPalRate, settlementFee } from "../settlement-fees";
import type { Settlement } from "./types";

/**
 * Domestic EUR PayPal-Sammelzahlungen (Payouts) fee from the DE fee page (last updated 2026-09-07, checked 2026-10-14):
 * "eine Gebühr für jede ... gesendeten Zahlung", 2 % of the amount, at most 12 EUR. The cap is applied per payment.
 * The page states no rounding rule; rounding to whole cents (half up) is our assumption.
 */
export const payoutRate = { basisPoints: 200, capCents: 1200,
  source: "https://www.paypal.com/de/business/paypal-business-fees", checked: "2026-10-14" };

export function payoutFee(grossCents: number, rate = payoutRate) {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) throw new Error("Invalid payout amount");
  return grossCents === 0 ? 0 : Math.min(Math.round((grossCents * rate.basisPoints) / 10_000), rate.capCents);
}

/**
 * What the operator keeps after PayPal fees only: bills received minus payouts sent, minus the receiving fee on each
 * bill and the sending fee on each payout. No other cost (time, hosting, model, meters, tax) is included.
 * Zero-amount statements are not sent, so they carry no fee.
 */
export function afterPaymentFees(s: Pick<Settlement, "consumers" | "producers">, billRate = illustrativePayPalRate) {
  const bills = s.consumers.map((c) => c.amountCents).filter((a) => a > 0);
  const payouts = s.producers.map((p) => p.amountCents).filter((a) => a > 0);
  const billedCents = bills.reduce((t, a) => t + a, 0);
  const paidOutCents = payouts.reduce((t, a) => t + a, 0);
  const billFeeCents = bills.reduce((t, a) => t + settlementFee(a, billRate).feeCents, 0);
  const payoutFeeCents = payouts.reduce((t, a) => t + payoutFee(a), 0);
  return {
    bills: bills.length,
    payouts: payouts.length,
    billedCents,
    paidOutCents,
    retainedCents: billedCents - paidOutCents,
    billFeeCents,
    payoutFeeCents,
    remainderCents: billedCents - paidOutCents - billFeeCents - payoutFeeCents,
  };
}
