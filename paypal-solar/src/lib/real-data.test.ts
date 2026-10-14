import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allocateAll, monthlyTotals } from "./allocate";
import { demoGroup } from "./demo-group";
import { buildRealJune, h25Dynamisation, type H25June, type PvgisJune } from "./real-data";

const dir = path.join(__dirname, "..", "data");
const pvFile = path.join(dir, "pvgis-frankfurt-2023-06.json");
const h25File = path.join(dir, "h25-june.json"); // git-ignored, created by `npm run fetch-data`
const haveData = existsSync(pvFile) && existsSync(h25File);

it("dynamisation factor is 1.24 at the start of the year", () => {
  expect(h25Dynamisation(0)).toBeCloseTo(1.24, 6);
});

describe.skipIf(!haveData)("June 2026 from PVGIS + BDEW H25", () => {
  const pv = JSON.parse(readFileSync(pvFile, "utf8")) as PvgisJune;
  const h25 = JSON.parse(readFileSync(h25File, "utf8")) as H25June;
  const intervals = buildRealJune(demoGroup, pv, h25);
  const t = monthlyTotals(demoGroup, intervals, allocateAll(demoGroup, intervals));

  it("has 2,880 quarter-hours and PV energy equal to PVGIS June × kWp", () => {
    expect(intervals).toHaveLength(30 * 96);
    const pvgisKWh = pv.hours.reduce((s, h) => s + h.w, 0) / 1000;
    expect(t.generationWh / 1000).toBeCloseTo(pvgisKWh * demoGroup.producer.kWp, -1); // within ~5 kWh of rounding
  });

  it("scales H25 so a 3,500 kWh household uses about 250 kWh in June (≈7.1 % of the year)", () => {
    expect(t.loadWh.h3 / 1000).toBeGreaterThan(240);
    expect(t.loadWh.h3 / 1000).toBeLessThan(260);
  });

  it("has no PV at night and keeps the producer's self-use within its generation", () => {
    const night = intervals.filter((iv) => iv.start.includes("T01:") || iv.start.includes("T23:"));
    expect(night.every((iv) => iv.generationWh === 0)).toBe(true);
    expect(intervals.every((iv) => iv.selfUseWh <= iv.generationWh)).toBe(true);
  });
});
