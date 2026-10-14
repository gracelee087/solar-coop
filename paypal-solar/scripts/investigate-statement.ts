import "./env";
import path from "node:path";
import { google } from "@ai-sdk/google";
import { loadWorkbench, saveInvestigation } from "../src/lib/coop/workbench";
import { investigateStatement } from "../src/lib/coop/investigation-agent";

async function main() {
  const [period, draftId, ...flags] = process.argv.slice(2);
  const source = flags.includes("--rehearsal") ? "rehearsal" : "agent";
  if (!period || !draftId) throw new Error("Usage: npm run coop:investigate -- YYYY-MM draft-id [--rehearsal] [--live]");
  const runs = path.join(process.cwd(), "runs");
  const item = loadWorkbench(runs, period, source)?.items.find((i) => i.draftId === draftId);
  if (!item || !item.work.messages.length || item.work.status !== "open") throw new Error("Add a customer message to an open statement case first");
  const model = process.env.COOP_AGENT_MODEL ?? "gemini-3.5-flash-lite";
  if (!flags.includes("--live")) {
    console.log(JSON.stringify({ mode: "dry-run", period, draftId, source, model, evidenceIds: item.evidence.map((e) => e.id), characters: JSON.stringify(item.evidence).length, externalCalls: 0 }, null, 2));
    return;
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("Gemini key is missing");
  const result = await investigateStatement(item, google(model));
  if (!result.proposal) throw new Error(`No accepted proposal; the case stays open. ${result.problems.join("; ")}`);
  saveInvestigation(runs, { period, source, draftId }, item.basis, result.proposal, model);
  console.log("Investigation saved for human review. No payment or message sent.");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
