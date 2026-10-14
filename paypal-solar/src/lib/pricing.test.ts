import { describe, expect, it } from "vitest";
import { moneyFlows, monthlyBreakdown, monthlyEconomics, monthlyPriceWindow, paypalFeeCents, priceWindow, regulatedGrossCt } from "./pricing";
import { defaultSettings } from "./tariffs";

describe("price window (Frankfurt 2026)", () => {
  it("matches the hand-checked numbers with electricity tax on shared kWh", () => {
    expect(regulatedGrossCt(defaultSettings)).toBeCloseTo(19.773, 3); // 16.616 net × 1.19
    expect(priceWindow(defaultSettings)).toEqual({ floorCt: 8.7, ceilingCt: 19.0, viable: true });
  });

  it("widens when shared kWh are exempt from electricity tax", () => {
    const w = priceWindow({ ...defaultSettings, electricityTaxOnShared: false });
    expect(regulatedGrossCt({ ...defaultSettings, electricityTaxOnShared: false })).toBeCloseTo(17.334, 3);
    expect(w.ceilingCt).toBe(21.44);
  });

  it("is not viable when the fee eats the whole margin", () => {
    expect(priceWindow({ ...defaultSettings, platformFeeCt: 12 }).viable).toBe(false);
  });
});

describe("monthly economics", () => {
  it("at the floor the producer only loses the PayPal fee; at the ceiling the consumer only loses the meter share", () => {
    const { floorCt, ceilingCt } = priceWindow(defaultSettings);
    const atFloor = monthlyEconomics(200_000, floorCt, defaultSettings);
    expect(atFloor.producerGainCents).toBe(-atFloor.paypalFeeCents);
    const atCeiling = monthlyEconomics(200_000, ceilingCt, defaultSettings);
    // 30 €/year smart meter → 2.50 €/month; per-item cent rounding and the inward-rounded ceiling leave 2 cents.
    expect(atCeiling.consumerSavingCents).toBe(-248);
  });

  it("splits a 200 kWh month at 14 ct", () => {
    const e = monthlyEconomics(200_000, 14, defaultSettings);
    expect(e.energyChargeCents).toBe(2800);
    expect(e.paypalFeeCents).toBe(123); // 2.99 % of 28.00 € = 0.84 € + 0.39 €
    expect(e.producerGainCents).toBe(Math.round(200 * (14 - 1 - 7.7)) - 123);
    expect(e.platformFeeCents).toBe(200);
  });

  it("charges no PayPal fee when nothing is invoiced", () => {
    expect(paypalFeeCents(0)).toBe(0);
  });
});

describe("monthly price window (fixed costs included)", () => {
  const both = (wh: number, p: number) => monthlyEconomics(wh, p, defaultSettings);

  it("both sides are at least 1 cent better off at both edges, after cent rounding", () => {
    for (const wh of [96_170, 131_310, 200_000, 600_000]) {
      const w = monthlyPriceWindow(wh, defaultSettings);
      expect(w.viable).toBe(true);
      for (const p of [w.floorCt, w.ceilingCt]) {
        expect(both(wh, p).producerGainCents).toBeGreaterThanOrEqual(1);
        expect(both(wh, p).consumerSavingCents).toBeGreaterThanOrEqual(1);
      }
      // one step outside, the respective side is no longer better off
      expect(both(wh, w.floorCt - 0.01).producerGainCents).toBeLessThan(1);
      expect(both(wh, w.ceilingCt + 0.01).consumerSavingCents).toBeLessThan(1);
    }
  });

  it("is narrower than the per-kWh window because of the PayPal fee and the smart-meter share", () => {
    const perKWh = priceWindow(defaultSettings);
    const w = monthlyPriceWindow(200_000, defaultSettings);
    expect(w.floorCt).toBeGreaterThan(perKWh.floorCt);
    expect(w.ceilingCt).toBeLessThan(perKWh.ceilingCt);
  });

  it("no deal when nothing was shared", () => {
    expect(monthlyPriceWindow(0, defaultSettings).viable).toBe(false);
  });

  it("no deal when too little was shared to cover the smart-meter share", () => {
    // 10 kWh: even at the producer's floor the neighbour saves less than the 2.50 € meter share
    expect(monthlyPriceWindow(10_000, defaultSettings).viable).toBe(false);
  });

  it("finds the smallest viable month around the break-even volume", () => {
    const viable = (kWh: number) => monthlyPriceWindow(kWh * 1000, defaultSettings).viable;
    const first = Array.from({ length: 100 }, (_, i) => i + 1).find(viable)!;
    expect(viable(first - 1)).toBe(false);
    expect(viable(first)).toBe(true);
  }, 20_000); // ~3 s alone and over 5 s under full-suite load: up to 102 window searches.
});

describe("monthly cost breakdown", () => {
  const b = monthlyBreakdown(131_310, 12.64, defaultSettings);
  const sum = (xs: { cents: number }[]) => xs.reduce((t, x) => t + x.cents, 0);

  it("keeps the PayPal invoice apart from costs paid to others", () => {
    expect(b.invoice).toMatchObject({ cents: 1660, payer: "neighbour", receivedBy: "Producer, via PayPal invoice" });
    expect(b.neighbourOtherCosts.map((c) => c.label)).toEqual([
      "Grid fee (NRM)",
      "Concession fee",
      "CHP levy (KWKG)",
      "Offshore grid levy",
      "Special grid-use surcharge",
      "Electricity tax",
      "VAT on the items above",
      "Smart-meter share",
    ]);
    expect(b.neighbourOtherCosts.some((c) => c.receivedBy.includes("PayPal"))).toBe(false);
    expect(b.producerCosts.every((c) => c.payer === "producer")).toBe(true);
  });

  it("shows net unit prices plus a VAT line that add up to the gross regulated cost per kWh", () => {
    const perKWh = b.neighbourOtherCosts.filter((c) => c.unitCt !== null);
    const netSum = perKWh.slice(0, -1).reduce((t, c) => t + c.unitCt!, 0);
    expect(perKWh.at(-1)!.unitCt).toBeCloseTo(netSum * 0.19, 9);
    expect(netSum + perKWh.at(-1)!.unitCt!).toBeCloseTo(regulatedGrossCt(defaultSettings), 9);
    expect(b.neighbourOtherCosts.at(-1)).toMatchObject({ label: "Smart-meter share", unitCt: null, appliedTo: "1 month", cents: 250 });
  });

  it("every line carries rate, quantity, payer, receiver and source", () => {
    for (const c of [b.invoice, ...b.neighbourOtherCosts, ...b.producerCosts, b.neighbourAlternative, b.producerAlternative]) {
      expect(c.rate && c.appliedTo && c.payer && c.receivedBy && c.source).toBeTruthy();
    }
  });

  it("the summary figures are exactly the sums of the item lines (no fee counted twice)", () => {
    const f = moneyFlows(b);
    expect(f.neighbour.paidToProducerCents).toBe(b.invoice.cents);
    expect(f.neighbour.otherCostsCents).toBe(sum(b.neighbourOtherCosts));
    expect(f.neighbour.totalCents).toBe(b.invoice.cents + sum(b.neighbourOtherCosts));
    expect(f.neighbour.withoutSharingCents).toBe(b.neighbourAlternative.cents);
    expect(f.neighbour.savingCents).toBe(f.neighbour.withoutSharingCents - f.neighbour.totalCents);
    expect(f.producer.salesCents).toBe(b.invoice.cents);
    expect(f.producer.deductionsCents).toBe(sum(b.producerCosts));
    expect(b.producerCosts.map((c) => c.label)).toEqual(["PayPal fee", "Platform fee"]); // once each
    expect(f.producer.netReceivedCents).toBe(b.invoice.cents - sum(b.producerCosts));
    expect(f.producer.extraGainCents).toBe(f.producer.netReceivedCents - b.producerAlternative.cents);
    const e = monthlyEconomics(131_310, 12.64, defaultSettings);
    expect(e.consumerSavingCents).toBe(f.neighbour.savingCents);
    expect(e.producerGainCents).toBe(f.producer.extraGainCents);
  });

  it("drops the electricity tax line when shared kWh are exempt", () => {
    const exempt = monthlyBreakdown(131_310, 12.64, { ...defaultSettings, electricityTaxOnShared: false });
    expect(exempt.neighbourOtherCosts.some((c) => c.label === "Electricity tax")).toBe(false);
  });
});
