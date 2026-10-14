/** Illustrative DE standard Checkout rate checked 2026-10-14. Actual product/account terms may differ. */
export const illustrativePayPalRate = { basisPoints: 299, fixedCents: 39,
  source: "https://www.paypal.com/de/business/paypal-business-fees", checked: "2026-10-14" };
export function settlementFee(grossCents: number, rate = illustrativePayPalRate) {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0 || grossCents > 100_000_000 || !Number.isSafeInteger(rate.basisPoints) || rate.basisPoints < 0 || !Number.isSafeInteger(rate.fixedCents) || rate.fixedCents < 0) throw new Error("Invalid fee input");
  const feeCents = grossCents === 0 ? 0 : Math.round(grossCents * rate.basisPoints / 10_000) + rate.fixedCents;
  return { grossCents, feeCents, sellerNetCents: grossCents - feeCents };
}
