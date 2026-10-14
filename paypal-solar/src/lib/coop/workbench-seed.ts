import { readFileSync } from "node:fs";
import path from "node:path";
import { runCoopAgent } from "./agent";
import { PaymentLedger } from "./ledger";
import { parseMeterCsv } from "./meter-csv";
import { scriptedCoopModel } from "./rehearsal";
import { sampleCoop } from "./sample-group";
import { updateState } from "./state";
import { loadWorkbench } from "./workbench";

/** Explicit first-run action. Does not overwrite an existing rehearsal or use any external service. */
export async function seedWorkbench(root: string) {
  const period = "2026-06";
  const runs = path.join(root, "runs");
  const existing = loadWorkbench(runs, period, "rehearsal");
  if (existing) return existing;
  const month = parseMeterCsv(sampleCoop, period, readFileSync(path.join(root, "src/data/coop-meter-2026-06.csv"), "utf8"));
  const ledger = new PaymentLedger(sampleCoop.participants, { name: "none", execute: async () => { throw new Error("Offline setup cannot execute a payment"); } });
  const result = await runCoopAgent({ group: sampleCoop, ledger, period, loadMonth: () => month, model: scriptedCoopModel(sampleCoop, period, month) });
  updateState(path.join(runs, "coop-rehearsal"), period, (current) => current ?? {
    period, source: "scripted_rehearsal", model: null, savedAt: new Date().toISOString(), drafts: ledger.list(), queue: result.queue, problems: result.problems,
  });
  return loadWorkbench(runs, period, "rehearsal")!;
}
