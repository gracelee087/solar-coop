import { expect, test } from "vitest";
import { afterPaymentFees, payoutFee } from "./costs";

const st = (bills: number[], payouts: number[]) => ({
  consumers: bills.map((amountCents) => ({ amountCents })),
  producers: payouts.map((amountCents) => ({ amountCents })),
}) as unknown as Parameters<typeof afterPaymentFees>[0];

test("payout fee is 2 % per payment, capped at 12 EUR per payment", () => {
  expect(payoutFee(4240)).toBe(85);
  expect(payoutFee(60_000)).toBe(1200);
  expect(payoutFee(100_000)).toBe(1200);
  expect(payoutFee(0)).toBe(0);
  expect(() => payoutFee(1.5)).toThrow();
});

test("fees are charged per transaction and zero amounts are not sent", () => {
  const r = afterPaymentFees(st([1500, 0], [1000]));
  expect(r).toMatchObject({ bills: 1, payouts: 1, retainedCents: 500, billFeeCents: 84, payoutFeeCents: 20, remainderCents: 396 });
});

test("the remainder may be negative and is reported as is", () => {
  expect(afterPaymentFees(st([100, 100], [180])).remainderCents).toBe(20 - 2 * (3 + 39) - 4);
});
