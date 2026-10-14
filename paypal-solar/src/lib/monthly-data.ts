import path from "node:path";
import { findAgreement } from "./agreement";
import { demoGroup, sandboxEmails } from "./demo-group";
import { findIssued } from "./issued";
import { prepareMonth, type MonthPlan } from "./monthly-settlement";
import { loadRealJuneFrom } from "./real-data-files";
import { defaultSettings } from "./tariffs";

/** Local files only. Catch loader failures as a blocked month, never as an empty successful settlement. */
export function loadMonthlyPlan(ledger: "recorded" | "empty_simulated_ledger" = "recorded"): MonthPlan {
  try {
    return prepareMonth({
      period: "2026-06", group: demoGroup, emails: sandboxEmails, settings: defaultSettings,
      intervals: loadRealJuneFrom(path.join(process.cwd(), "src", "data"), demoGroup), findAgreement,
      findIssued: ledger === "recorded" ? findIssued : () => null,
      sources: { agreement: "src/data/agreements.json", invoiceRecord: "src/data/issued-invoices.json", usage: "src/data/pvgis-frankfurt-2023-06.json + src/data/h25-june.json → buildRealJune → allocateAll → monthlyTotals (modelled)" },
    });
  } catch (e) {
    // Name only the missing file: an ENOENT message carries the absolute server path, which pages would display.
    const err = e as NodeJS.ErrnoException;
    const problem = err.code === "ENOENT" && err.path ? `Missing data file src/data/${path.basename(err.path)}. Run npm run fetch-data:h25.` : err.message;
    return { period: "2026-06", items: [], problems: [problem] };
  }
}
