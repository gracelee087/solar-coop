import path from "node:path";
import { loadHistoricalJunesFrom, loadRealJuneFrom } from "../src/lib/real-data-files";
import type { SharingGroup } from "../src/lib/types";

const DATA = path.join(__dirname, "..", "src", "data");

/** Modelled supply month: June 2026 with June 2023 weather (files written by `npm run fetch-data`). */
export function loadRealJune(group: SharingGroup) {
  return loadRealJuneFrom(DATA, group);
}

/** One June 2026 per weather year 2005–2022, for the expected values before supply. */
export function loadHistoricalJunes(group: SharingGroup) {
  return loadHistoricalJunesFrom(DATA, group);
}
