import { readFileSync } from "node:fs";
import path from "node:path";
import { buildRealJune, type H25June, type PvgisJune } from "./real-data";
import { validatePvgisJune } from "./data-validation";
import type { Interval, SharingGroup } from "./types";

export const PVGIS_FILE = "pvgis-frankfurt-2023-06.json";
export const H25_FILE = "h25-june.json"; // git-ignored, written by `npm run fetch-data`

/** June 2026 from the files in `dataDir` (server-side only: reads the file system). */
export function loadRealJuneFrom(dataDir: string, group: SharingGroup) {
  const read = <T>(f: string) => JSON.parse(readFileSync(path.join(dataDir, f), "utf8")) as T;
  const pv = read<PvgisJune>(PVGIS_FILE);
  validatePvgisJune(pv, 2023);
  return buildRealJune(group, pv, read<H25June>(H25_FILE));
}

export function pvgisAttribution(dataDir: string): string {
  return (JSON.parse(readFileSync(path.join(dataDir, PVGIS_FILE), "utf8")) as PvgisJune).attribution;
}

export const PVGIS_HISTORY_FILE = "pvgis-frankfurt-2005-2022-06.json";

/** One June 2026 per historical weather year (2005–2022), for the expected, pre-supply estimate. */
export function loadHistoricalJunesFrom(dataDir: string, group: SharingGroup): { year: string; intervals: Interval[] }[] {
  const pv = JSON.parse(readFileSync(path.join(dataDir, PVGIS_HISTORY_FILE), "utf8")) as {
    attribution: string;
    years: Record<string, PvgisJune["hours"]>;
  };
  const h25 = JSON.parse(readFileSync(path.join(dataDir, H25_FILE), "utf8")) as H25June;
  const expectedYears = Array.from({ length: 18 }, (_, i) => String(2005 + i));
  if (!pv?.years || Object.keys(pv.years).sort().join(",") !== expectedYears.join(",")) {
    throw new Error("PVGIS history: expected every weather year from 2005 to 2022, excluding 2023");
  }
  return expectedYears.map((year) => {
    const june = { attribution: pv.attribution, hours: pv.years[year] };
    validatePvgisJune(june, Number(year));
    return { year, intervals: buildRealJune(group, june, h25) };
  });
}
