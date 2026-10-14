import { expect, it } from "vitest";
import { settlementFee } from "./settlement-fees";
it("shows the cost of repeated small receipts versus one monthly payment", () => {
  expect(settlementFee(1500)).toEqual({ grossCents: 1500, feeCents: 84, sellerNetCents: 1416 });
  expect(settlementFee(50).feeCents * 30).toBe(1200);
  expect(settlementFee(0).feeCents).toBe(0);
  expect(() => settlementFee(NaN)).toThrow();
});
