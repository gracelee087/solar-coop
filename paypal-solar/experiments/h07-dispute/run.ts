// One live run of the investigation agent on the fixed Haus 7 input. Refuses to run twice.
// usage: npx tsx experiments/h07-dispute/run.ts [--live]   (needs GOOGLE_GENERATIVE_AI_API_KEY for --live)
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { google } from "@ai-sdk/google";
import { wrapLanguageModel } from "ai";
import { investigateStatement, INVESTIGATION_PROMPT } from "../../src/lib/coop/investigation-agent";
import { loadWorkbench, saveInvestigation } from "../../src/lib/coop/workbench";
import { sha, TARGET, toolInput } from "./prepare";

const MODEL = "gemini-3.5-flash-lite";
const dir = path.join(process.cwd(), "experiments", "h07-dispute");
const out = path.join(dir, "run-2026-10-15.json");
const runs = path.join(process.cwd(), "runs");

async function main() {
  if (existsSync(out)) throw new Error("A run is already saved. This experiment is run once; the first result is kept.");
  const item = loadWorkbench(runs, TARGET.period, TARGET.source)!.items.find((i) => i.draftId === TARGET.draftId)!;
  const input = JSON.stringify(toolInput(item), null, 2) + "\n";
  if (input !== readFileSync(path.join(dir, "input.json"), "utf8")) throw new Error("Input differs from the committed input.json");
  if (INVESTIGATION_PROMPT + "\n" !== readFileSync(path.join(dir, "prompt.txt"), "utf8")) throw new Error("Prompt differs from the committed prompt.txt");
  if (item.work.status !== "open") throw new Error("Case must be open");
  if (!process.argv.includes("--live")) { console.log(JSON.stringify({ mode: "dry-run", model: MODEL, inputSha256: sha(input), externalCalls: 0 })); return; }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("Gemini key is missing");
  const raw: unknown[] = [];
  const model = wrapLanguageModel({
    model: google(MODEL),
    middleware: { specificationVersion: "v3", wrapGenerate: async ({ doGenerate }) => { const r = await doGenerate(); raw.push({ content: r.content, finishReason: r.finishReason, usage: r.usage }); return r; } },
  });
  const ranAt = new Date().toISOString();
  // Every attempt is logged before the model is called, including ones that end in a network failure.
  appendFileSync(path.join(dir, "attempts.jsonl"), JSON.stringify({ attemptStartedAt: ranAt, model: MODEL, inputSha256: sha(input) }) + "\n");
  const result = await investigateStatement(item, model);
  const record = { experiment: "h07-dispute", ranAt, model: MODEL, inputSha256: sha(input), promptSha256: sha(INVESTIGATION_PROMPT + "\n"),
    modelRequests: raw.length, accepted: !!result.proposal, proposal: result.proposal,
    // Problems include proposals the code checks rejected before a later step was accepted.
    codeCheckProblems: result.problems, rawModelSteps: raw };
  writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
  if (result.proposal) saveInvestigation(runs, TARGET, item.basis, result.proposal, MODEL);
  console.log(JSON.stringify({ saved: path.relative(process.cwd(), out), accepted: record.accepted, problems: result.problems, steps: raw.length }));
}
main().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
