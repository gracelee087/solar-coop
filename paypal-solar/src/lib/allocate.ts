import type { Interval, IntervalAllocation, SharingGroup } from "./types";
import { validateGroup, validateInterval } from "./data-validation";

/**
 * Static allocation ("statische Aufteilung"): each household is offered a fixed share of the
 * producer's feed-in (generation minus its own consumption) in every interval and takes at most what it
 * consumes. Unused offers are surplus (in practice assigned to the direct marketer). All values are integer Wh,
 * so totals add up exactly.
 */
export function allocateInterval(group: SharingGroup, iv: Interval): IntervalAllocation {
  validateGroup(group);
  validateInterval(group, iv);
  const feedIn = iv.generationWh - iv.selfUseWh;
  const sharedWh: Record<string, number> = {};
  let shared = 0;
  for (const h of group.households) {
    const offer = Math.floor(feedIn * h.key);
    const take = Math.min(offer, iv.loadWh[h.id]);
    sharedWh[h.id] = take;
    shared += take;
  }
  return { start: iv.start, generationWh: iv.generationWh, selfUseWh: iv.selfUseWh, sharedWh, surplusWh: feedIn - shared };
}

export function allocateAll(group: SharingGroup, intervals: Interval[]): IntervalAllocation[] {
  validateGroup(group);
  return intervals.map((iv) => allocateInterval(group, iv));
}

export interface MonthlyTotals {
  generationWh: number;
  selfUseWh: number;
  surplusWh: number;
  sharedWh: Record<string, number>;
  loadWh: Record<string, number>;
}

export function monthlyTotals(
  group: SharingGroup,
  intervals: Interval[],
  allocs: IntervalAllocation[],
): MonthlyTotals {
  validateGroup(group);
  if (intervals.length !== allocs.length) throw new Error("Monthly totals: interval/allocation count mismatch");
  const t: MonthlyTotals = { generationWh: 0, selfUseWh: 0, surplusWh: 0, sharedWh: {}, loadWh: {} };
  for (const h of group.households) {
    t.sharedWh[h.id] = 0;
    t.loadWh[h.id] = 0;
  }
  allocs.forEach((a, i) => {
    validateInterval(group, intervals[i]);
    if (a.start !== intervals[i].start) throw new Error("Monthly totals: interval/allocation timestamp mismatch");
    t.generationWh += a.generationWh;
    t.selfUseWh += a.selfUseWh;
    t.surplusWh += a.surplusWh;
    for (const h of group.households) {
      t.sharedWh[h.id] += a.sharedWh[h.id];
      t.loadWh[h.id] += intervals[i].loadWh[h.id];
    }
  });
  for (const value of [t.generationWh, t.selfUseWh, t.surplusWh, ...Object.values(t.sharedWh), ...Object.values(t.loadWh)]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Monthly totals: invalid or unsafe Wh total");
  }
  return t;
}

/**
 * Expected month from several weather years: allocate each year on its own, then average the monthly totals.
 * Averaging the generation first would be wrong, because each share is capped at the household's consumption.
 */
export function averageMonthlyTotals(group: SharingGroup, runs: Interval[][]): MonthlyTotals {
  if (runs.length === 0) throw new Error("averageMonthlyTotals needs at least one run");
  const all = runs.map((iv) => monthlyTotals(group, iv, allocateAll(group, iv)));
  const avg = (pick: (t: MonthlyTotals) => number) => Math.round(all.reduce((s, t) => s + pick(t), 0) / all.length);
  const byHousehold = (pick: (t: MonthlyTotals) => Record<string, number>) =>
    Object.fromEntries(group.households.map((h) => [h.id, avg((t) => pick(t)[h.id])]));
  return {
    generationWh: avg((t) => t.generationWh),
    selfUseWh: avg((t) => t.selfUseWh),
    surplusWh: avg((t) => t.surplusWh),
    sharedWh: byHousehold((t) => t.sharedWh),
    loadWh: byHousehold((t) => t.loadWh),
  };
}
