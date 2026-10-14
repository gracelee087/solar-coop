import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { demoGroup } from "./demo-group";
import { H25_FILE, loadHistoricalJunesFrom, loadRealJuneFrom, PVGIS_FILE, PVGIS_HISTORY_FILE } from "./real-data-files";

const dir = mkdtempSync(path.join(tmpdir(), "paypal-solar-validation-"));
const sourceDir = path.join(__dirname, "..", "data");
const history = JSON.parse(readFileSync(path.join(sourceDir, PVGIS_HISTORY_FILE), "utf8"));
const supply = JSON.parse(readFileSync(path.join(sourceDir, PVGIS_FILE), "utf8"));
const save = (file: string, data: unknown) => writeFileSync(path.join(dir, file), JSON.stringify(data));
save(H25_FILE, { profile: { WT: Array(96).fill(100), SA: Array(96).fill(100), FT: Array(96).fill(100) } });

afterAll(() => {
  // Delete only the task's verified temporary directory.
  if (path.dirname(path.resolve(dir)) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith("paypal-solar-validation-")) {
    throw new Error("Unexpected test temporary directory");
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("weather year validation at the file boundary", () => {
  it("requires all 18 historical years, rejecting an omitted year or the settlement year", () => {
    const missing = structuredClone(history);
    delete missing.years["2005"];
    save(PVGIS_HISTORY_FILE, missing);
    expect(() => loadHistoricalJunesFrom(dir, demoGroup)).toThrow("every weather year");
    const extra = structuredClone(history);
    extra.years["2023"] = supply.hours;
    save(PVGIS_HISTORY_FILE, extra);
    expect(() => loadHistoricalJunesFrom(dir, demoGroup)).toThrow("excluding 2023");
  });

  it("rejects an empty historical year and hours mislabeled as another year", () => {
    const empty = structuredClone(history);
    empty.years["2005"] = [];
    save(PVGIS_HISTORY_FILE, empty);
    expect(() => loadHistoricalJunesFrom(dir, demoGroup)).toThrow("720");
    const mislabeled = structuredClone(history);
    mislabeled.years["2005"] = mislabeled.years["2006"];
    save(PVGIS_HISTORY_FILE, mislabeled);
    expect(() => loadHistoricalJunesFrom(dir, demoGroup)).toThrow("expected 200506");
  });

  it("requires 2023 weather in the settlement file", () => {
    save(PVGIS_FILE, { ...supply, hours: history.years["2022"] });
    expect(() => loadRealJuneFrom(dir, demoGroup)).toThrow("expected 202306");
  });

  it("loads the complete source into 18 complete historical months and one settlement month", () => {
    save(PVGIS_HISTORY_FILE, history);
    save(PVGIS_FILE, supply);
    const months = loadHistoricalJunesFrom(dir, demoGroup);
    expect(months).toHaveLength(18);
    expect(months.map((m) => m.year)).toEqual(Array.from({ length: 18 }, (_, i) => String(2005 + i)));
    expect(months.every((m) => m.intervals.length === 2880)).toBe(true);
    expect(loadRealJuneFrom(dir, demoGroup)).toHaveLength(2880);
  });
});
