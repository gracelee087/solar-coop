// Pure money calculations shared by the server view and the browser what-if (no data files, no AI SDK).
import { moneyFlows, monthlyBreakdown, monthlyEconomics, type MoneyFlows, type MonthlyBreakdown, type MonthlyEconomics, type PriceWindow } from "./pricing";
import type { PricingSettings } from "./tariffs";

/** Energy and money of one neighbour's month at a given price. */
export interface Outcome {
  usedKWh: number;
  sharedKWh: number;
  coveragePct: number;
  economics: MonthlyEconomics;
  breakdown: MonthlyBreakdown;
  /** Summary figures for both sides; each is a sum of breakdown lines. */
  flows: MoneyFlows;
}

export const kWh = (wh: number) => Math.round(wh / 10) / 100;

export function outcome(usedWh: number, sharedWh: number, priceCt: number, s: PricingSettings): Outcome {
  const breakdown = monthlyBreakdown(sharedWh, priceCt, s);
  return {
    usedKWh: kWh(usedWh),
    sharedKWh: kWh(sharedWh),
    coveragePct: Math.round((100 * sharedWh) / usedWh),
    economics: monthlyEconomics(sharedWh, priceCt, s),
    breakdown,
    flows: moneyFlows(breakdown),
  };
}

export interface WhatIfInput {
  window: PriceWindow;
  /** Unrounded energies of the household: expected (before supply) and modelled supply month. */
  energyWh: { expectedShared: number; expectedUsed: number; settledShared: number; settledUsed: number };
}

/**
 * Price-only what-if: the same energies at another price inside the household's window. A preview only: it takes
 * nothing from and changes nothing in the agreement, the settlement or any issued invoice. Null outside the window.
 */
export function whatIf(h: WhatIfInput, priceCt: number, s: PricingSettings): { priceCt: number; expected: Outcome; settled: Outcome } | null {
  if (!Number.isFinite(priceCt) || !h.window.viable || priceCt < h.window.floorCt || priceCt > h.window.ceilingCt) return null;
  return {
    priceCt,
    expected: outcome(h.energyWh.expectedUsed, h.energyWh.expectedShared, priceCt, s),
    settled: outcome(h.energyWh.settledUsed, h.energyWh.settledShared, priceCt, s),
  };
}
