import { readFileSync } from "node:fs";
import path from "node:path";
import { runCoopAgent } from "./agent";
import { billingInputs, meterFileFor } from "./billing-check";
import { PaymentLedger } from "./ledger";
import { parseMeterCsv } from "./meter-csv";
import { scriptedCoopModel } from "./rehearsal";
import { sampleCoop } from "./sample-group";
import { updateState } from "./state";
import { loadWorkbench } from "./workbench";

/** Explicit first-run action. Does not overwrite an existing rehearsal or use any external service. */
/** `root` holds the meter files; `runs` is where the rehearsal is saved (a visitor's own folder in the hosted demo). */
export async function seedWorkbench(root: string, runs = path.join(root, "runs")) {
  const period = "2026-06";
  const existing = loadWorkbench(runs, period, "rehearsal", root);
  if (existing) return existing;
  const text = readFileSync(path.join(root, meterFileFor(period)), "utf8");
  const month = parseMeterCsv(sampleCoop, period, text);
  const ledger = new PaymentLedger(sampleCoop.participants, { name: "none", execute: async () => { throw new Error("Offline setup cannot execute a payment"); } });
  const result = await runCoopAgent({ group: sampleCoop, ledger, period, loadMonth: () => month, model: scriptedCoopModel(sampleCoop, period, month) });
  updateState(path.join(runs, "coop-rehearsal"), period, (current) => current ?? {
    period, source: "scripted_rehearsal", model: null, savedAt: new Date().toISOString(), drafts: ledger.list(), queue: result.queue, problems: result.problems,
    inputs: billingInputs(sampleCoop, meterFileFor(period), text),
  });
  return loadWorkbench(runs, period, "rehearsal", root)!;
}
