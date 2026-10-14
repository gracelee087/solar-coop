import path from "node:path";
import { allAgreements } from "./agreement";
import { buildDashboard, recordedRun, type DashboardView } from "./dashboard";
import { demoGroup } from "./demo-group";
import { loadMonthlyPlan } from "./monthly-data";
import type { MonthPlan } from "./monthly-settlement";
import { loadHistoricalJunesFrom, loadRealJuneFrom, pvgisAttribution } from "./real-data-files";
import { defaultSettings, TARIFFS, type Param } from "./tariffs";

export interface SourceRow extends Param {
  key: string;
}

export interface DashboardPageData {
  view: DashboardView;
  sources: SourceRow[];
  pvgisAttribution: string;
  monthlyPlan: MonthPlan;
}

/** Server-side only: reads the data files and replays the saved agreements (no PayPal or Gemini call). */
export function loadDashboardPageData(): DashboardPageData {
  const dir = path.join(process.cwd(), "src", "data");
  const view = buildDashboard(loadRealJuneFrom(dir, demoGroup), loadHistoricalJunesFrom(dir, demoGroup), defaultSettings, recordedRun(allAgreements()));
  const sources = Object.entries(TARIFFS).map(([key, p]) => ({ key, ...(p as Param) }));
  return { view, sources, pvgisAttribution: pvgisAttribution(dir), monthlyPlan: loadMonthlyPlan() };
}
