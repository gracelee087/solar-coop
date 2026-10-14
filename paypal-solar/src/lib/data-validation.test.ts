import { describe, expect, it } from "vitest";
import { allocateAll, monthlyTotals } from "./allocate";
import { demoGroup } from "./demo-group";
import { requireNonnegative, validateJuneIntervals, validatePvgisJune } from "./data-validation";
import { buildRealJune, type H25June, type PvgisJune } from "./real-data";

const makePv = (): PvgisJune => ({
  attribution: "Synthetic test fixture",
  hours: Array.from({ length: 720 }, (_, i) => ({
    utc: `202306${String(Math.floor(i / 24) + 1).padStart(2, "0")}:${String(i % 24).padStart(2, "0")}10`,
    w: i % 24 >= 6 && i % 24 < 18 ? 500 : 0,
  })),
});
const makeH25 = (): H25June => ({ profile: { WT: Array(96).fill(100), SA: Array(96).fill(100), FT: Array(96).fill(100) } });
const makeIntervals = () => buildRealJune(demoGroup, makePv(), makeH25());

describe("source validation before conversion", () => {
  it("rejects an empty PVGIS source instead of manufacturing a complete zero-generation month", () => {
    expect(() => buildRealJune(demoGroup, { attribution: "missing", hours: [] }, makeH25())).toThrow("720");
  });

  it("rejects a missing hour and a duplicate replacing an hour", () => {
    const pv = makePv();
    pv.hours.splice(123, 1);
    expect(() => buildRealJune(demoGroup, pv, makeH25())).toThrow("720");
    const duplicate = makePv();
    duplicate.hours[123] = duplicate.hours[122];
    expect(() => buildRealJune(demoGroup, duplicate, makeH25())).toThrow("duplicate");
  });

  it("rejects wrong year, invalid date and swapped timestamps even when there are 720 rows", () => {
    expect(() => validatePvgisJune(makePv(), 2022)).toThrow("expected 202206");
    for (const timestamp of ["20230701:0010", "20230631:0010", "20230601:0000"]) {
      const pv = makePv();
      pv.hours[0].utc = timestamp;
      expect(() => buildRealJune(demoGroup, pv, makeH25())).toThrow("expected");
    }
    const pv = makePv();
    [pv.hours[12], pv.hours[13]] = [pv.hours[13], pv.hours[12]];
    expect(() => buildRealJune(demoGroup, pv, makeH25())).toThrow("order");
  });

  it.each([NaN, Infinity, -Infinity, -1, null, undefined, "", "100"])("rejects invalid PV/H25 values without coercion: %s", (value) => {
    const pv = makePv();
    pv.hours[100].w = value as number;
    expect(() => buildRealJune(demoGroup, pv, makeH25())).toThrow("finite, non-negative");
    const h25 = makeH25();
    h25.profile.WT[0] = value as number;
    expect(() => buildRealJune(demoGroup, makePv(), h25)).toThrow("H25 WT");
    expect(() => requireNonnegative(value, "Excel cell")).toThrow("Excel cell");
  });

  it("rejects missing H25 day types and shortened or sparse profiles", () => {
    const missing = makeH25();
    delete (missing.profile as Partial<H25June["profile"]>).SA;
    expect(() => buildRealJune(demoGroup, makePv(), missing)).toThrow("H25 SA");
    const short = makeH25();
    short.profile.FT.pop();
    expect(() => buildRealJune(demoGroup, makePv(), short)).toThrow("96");
    const sparse = makeH25();
    delete sparse.profile.WT[3];
    expect(() => buildRealJune(demoGroup, makePv(), sparse)).toThrow("quarter-hour 3");
  });

  it("accepts explicit zero generation and consumption as complete valid data", () => {
    const pv = makePv();
    pv.hours.forEach((h) => { h.w = 0; });
    const h25 = makeH25();
    Object.values(h25.profile).forEach((values) => values.fill(0));
    const intervals = buildRealJune(demoGroup, pv, h25);
    expect(intervals).toHaveLength(2880);
    const totals = monthlyTotals(demoGroup, intervals, allocateAll(demoGroup, intervals));
    expect(totals.generationWh).toBe(0);
    expect(totals.loadWh).toEqual({ h1: 0, h2: 0, h3: 0 });
  });

  it("uses the preceding June UTC day for local early hours; only the May boundary is assumed zero", () => {
    const pv = makePv();
    pv.hours[22].w = 400;
    const intervals = buildRealJune(demoGroup, pv, makeH25());
    expect(intervals[0].generationWh).toBe(0);
    expect(intervals[96].generationWh).toBe(Math.round(400 * demoGroup.producer.kWp * 0.25));
  });
});

describe("converted month and allocation validation", () => {
  it("rejects missing, duplicate, shifted and zone-less quarter-hours", () => {
    const intervals = makeIntervals();
    expect(() => validateJuneIntervals(demoGroup, intervals.slice(1))).toThrow("2,880");
    for (const time of [intervals[0].start, "2026-07-01T00:15:00+02:00", "2026-06-01T00:20:00+02:00", "2026-06-01T00:15:00"]) {
      const bad = structuredClone(intervals);
      bad[1].start = time;
      expect(() => validateJuneIntervals(demoGroup, bad)).toThrow("expected interval");
    }
  });

  it("rejects a missing household reading instead of allocating zero", () => {
    const intervals = makeIntervals();
    delete intervals[0].loadWh.h2;
    expect(() => validateJuneIntervals(demoGroup, intervals)).toThrow("h2 loadWh");
    expect(() => allocateAll(demoGroup, intervals)).toThrow("h2 loadWh");
  });

  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid converted Wh: %s", (value) => {
    const intervals = makeIntervals();
    intervals[0].generationWh = value;
    expect(() => validateJuneIntervals(demoGroup, intervals)).toThrow();
    expect(() => allocateAll(demoGroup, intervals)).toThrow();
  });

  it("rejects self-use above generation", () => {
    const intervals = makeIntervals();
    intervals[0].selfUseWh = 1;
    expect(() => allocateAll(demoGroup, intervals)).toThrow("self-use exceeds generation");
  });

  it.each([NaN, Infinity, -Infinity])("rejects non-finite allocation keys: %s", (value) => {
    const group = structuredClone(demoGroup);
    group.households[0].key = value;
    expect(() => allocateAll(group, makeIntervals())).toThrow("allocation key");
  });

  it("rejects non-finite generation scale and duplicate household ids", () => {
    const group = structuredClone(demoGroup);
    group.producer.kWp = NaN;
    expect(() => buildRealJune(group, makePv(), makeH25())).toThrow("producer kWp");
    const duplicate = structuredClone(demoGroup);
    duplicate.households[1].id = duplicate.households[0].id;
    expect(() => allocateAll(duplicate, makeIntervals())).toThrow("Duplicate");
  });

  it("rejects misaligned allocations and invalid monthly totals", () => {
    const intervals = makeIntervals();
    const allocations = allocateAll(demoGroup, intervals);
    expect(() => monthlyTotals(demoGroup, intervals, allocations.slice(1))).toThrow("count mismatch");
    allocations[1].start = allocations[0].start;
    expect(() => monthlyTotals(demoGroup, intervals, allocations)).toThrow("timestamp mismatch");
    allocations[1].start = intervals[1].start;
    allocations[1].sharedWh.h1 = NaN;
    expect(() => monthlyTotals(demoGroup, intervals, allocations)).toThrow("invalid or unsafe");
  });
});
