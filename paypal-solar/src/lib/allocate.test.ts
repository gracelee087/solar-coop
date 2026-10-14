import { describe, expect, it } from "vitest";
import { allocateAll, allocateInterval, averageMonthlyTotals, monthlyTotals } from "./allocate";
import { demoGroup } from "./demo-group";
import { simulateMonth } from "./simulate";

describe("allocateInterval", () => {
  it("caps each share at the household's consumption and sends the rest to surplus", () => {
    const a = allocateInterval(demoGroup, {
      start: "x",
      generationWh: 1200,
      selfUseWh: 200,
      loadWh: { h1: 100, h2: 500, h3: 0 },
    });
    expect(a.sharedWh).toEqual({ h1: 100, h2: 300, h3: 0 }); // offers are 30/30/20 % of the 1000 Wh feed-in
    expect(a.surplusWh).toBe(600);
  });
});

describe("simulated month", () => {
  const intervals = simulateMonth(demoGroup);
  const allocs = allocateAll(demoGroup, intervals);

  it("has 30 days x 96 quarter-hours with no generation at night", () => {
    expect(intervals).toHaveLength(30 * 96);
    expect(intervals[0].generationWh).toBe(0);
    expect(intervals[0].start).toBe("2026-06-01T00:00:00+02:00");
  });

  it("keeps the allocation invariants in every interval", () => {
    allocs.forEach((a, i) => {
      const shared = Object.values(a.sharedWh).reduce((s, x) => s + x, 0);
      expect(a.selfUseWh + shared + a.surplusWh).toBe(a.generationWh);
      expect(a.surplusWh).toBeGreaterThanOrEqual(0);
      for (const h of demoGroup.households) {
        expect(a.sharedWh[h.id]).toBeLessThanOrEqual(intervals[i].loadWh[h.id]);
      }
    });
  });

  it("monthly totals reconcile with the intervals", () => {
    const t = monthlyTotals(demoGroup, intervals, allocs);
    const shared = Object.values(t.sharedWh).reduce((s, x) => s + x, 0);
    expect(t.selfUseWh + shared + t.surplusWh).toBe(t.generationWh);
    expect(shared).toBeGreaterThan(0);
  });

  it("is reproducible for the same seed", () => {
    expect(simulateMonth(demoGroup)).toEqual(intervals);
  });
});

it("rejects keys that sum above 1", () => {
  const bad = {
    ...demoGroup,
    households: [
      { id: "a", name: "a", key: 0.7, annualKWh: 1 },
      { id: "b", name: "b", key: 0.5, annualKWh: 1 },
    ],
  };
  expect(() => allocateAll(bad, [])).toThrow();
});

describe("averageMonthlyTotals", () => {
  const iv = (generationWh: number) => ({ start: "x", generationWh, selfUseWh: 0, loadWh: { h1: 500, h2: 0, h3: 0 } });

  it("allocates each year first, then averages (the consumption cap makes the order matter)", () => {
    // sunny year: offer 30 % of 2,000 = 600 Wh, capped at 500 Wh use; dark year: 0
    const t = averageMonthlyTotals(demoGroup, [[iv(2000)], [iv(0)]]);
    expect(t.sharedWh.h1).toBe(250);
    // averaging the generation first (1,000 Wh) would give min(300, 500) = 300 Wh
    const wrong = monthlyTotals(demoGroup, [iv(1000)], allocateAll(demoGroup, [iv(1000)]));
    expect(wrong.sharedWh.h1).toBe(300);
  });
});
