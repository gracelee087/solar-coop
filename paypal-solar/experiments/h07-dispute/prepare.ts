// Builds the fixed Haus 7 input in a rehearsal (no external calls) and writes input.json + prompt.txt.
// usage (in a copy whose runs/ holds a fresh June rehearsal): npx tsx experiments/h07-dispute/prepare.ts
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { INVESTIGATION_PROMPT } from "../../src/lib/coop/investigation-agent";
import { loadWorkbench, workbenchAction } from "../../src/lib/coop/workbench";

export const TARGET = { period: "2026-06", source: "rehearsal" as const, draftId: "bill-ST-202606-H07" };
export const MESSAGE = "My meter shows about 193 kWh for 2026-06, but your bill says 95.1 kWh. Which one is right? Reference ST-202606-H07.";
export const EVIDENCE = "Fictional reply: the metering operator confirms 192.6 kWh for 2026-06, matching the meter file.";
const runs = path.join(process.cwd(), "runs");
const item = () => loadWorkbench(runs, TARGET.period, TARGET.source)!.items.find((i) => i.draftId === TARGET.draftId)!;
/** Exactly what the model's get_statement tool returns. */
export const toolInput = (i: ReturnType<typeof item>) => ({ statementId: i.statementId, kind: i.kind, topic: i.work.topic, evidence: i.evidence });
export const sha = (text: string) => createHash("sha256").update(text).digest("hex");

if (process.argv[1]?.endsWith("prepare.ts")) {
  if (item().work.messages.length) throw new Error("Haus 7 already has a case; start from a fresh rehearsal");
  workbenchAction(runs, { ...TARGET, action: "message", by: "Demo operator", topic: "meter", text: MESSAGE, version: item().version });
  workbenchAction(runs, { ...TARGET, action: "evidence", by: "Demo operator", origin: "metering_operator", text: EVIDENCE, version: item().version });
  const dir = path.join(process.cwd(), "experiments", "h07-dispute");
  const input = JSON.stringify(toolInput(item()), null, 2) + "\n";
  writeFileSync(path.join(dir, "input.json"), input);
  writeFileSync(path.join(dir, "prompt.txt"), INVESTIGATION_PROMPT + "\n");
  console.log(JSON.stringify({ inputSha256: sha(input), promptSha256: sha(INVESTIGATION_PROMPT + "\n"), status: item().work.status, evidenceIds: item().evidence.map((e) => e.id) }, null, 2));
}
