// Monthly cooperative settlement: the agent prepares drafts for approval, a person approves or rejects them.
//   npm run coop -- rehearse 2026-06            scripted model, no external calls (runs/coop-rehearsal/)
//   npm run coop -- run 2026-06                 Gemini drives the tools (runs/coop/); never executes payments
//   npm run coop -- list 2026-06 [--rehearsal]
//   npm run coop -- approve 2026-06 <draftId> <your name> [--rehearsal]
//   npm run coop -- reject 2026-06 <draftId> <your name> <reason> [--rehearsal]
//   ALLOW_COOP_SANDBOX=true npm run coop -- execute 2026-06 <draftId>   one approved draft, PayPal sandbox only
//   npm run coop -- exceptions-rules            fixed rule baseline over the exception cases (offline, not AI)
//   npm run coop -- exceptions-run              Gemini proposes an action per exception case (read and propose only)
//   npm run coop -- exceptions-eval             Gemini on the held-out cases, scored against their frozen answers
//   npm run coop -- replay-reset 2026-06        copy of the real run before approval, for the desk (?source=replay)
//   npm run coop -- check 2026-06 <draftId> | check-all 2026-06   read-only PayPal lookup + reconciliation
import "./env";
import { google } from "@ai-sdk/google";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runCoopAgent } from "../src/lib/coop/agent";
import { PaymentLedger } from "../src/lib/coop/ledger";
import { billingInputs, meterFileFor } from "../src/lib/coop/billing-check";
import { parseMeterCsv } from "../src/lib/coop/meter-csv";
import { findInvoiceByNumber, getInvoice } from "../src/lib/paypal-api";
import { getPayoutBatch, paypalRail, type PaymentRail } from "../src/lib/coop/rail";
import { reconcileBill, reconcilePayout, type Reconciliation } from "../src/lib/coop/reconcile";
import { withSandboxEmails } from "../src/lib/coop/sandbox-accounts";
import { scriptedCoopModel } from "../src/lib/coop/rehearsal";
import { sampleCoop } from "../src/lib/coop/sample-group";
import { EXCEPTION_CASES } from "../src/lib/coop/exception-cases";
import { HOLDOUT_CASES, HOLDOUT_EXPECTED } from "../src/lib/coop/exception-holdout";
import { ruleAction, scoreAccepted } from "../src/lib/coop/exception-rules";
import { newRunId, ruleBaselineRun, saveExceptionRun } from "../src/lib/coop/exception-desk";
import { runExceptionAgent } from "../src/lib/coop/exceptions";
import { executeSavedDraft } from "../src/lib/coop/execute-saved";
import { loadState, updateState, type CoopState } from "../src/lib/coop/state";

const ROOT = path.join(__dirname, "..");
const noExecution: PaymentRail = {
  name: "none",
  execute: async () => {
    throw new Error("Payment execution is not part of this command");
  },
};

const readMeter = (period: string) => readFileSync(path.join(ROOT, meterFileFor(period)), "utf8");

async function main() {
  const args = process.argv.slice(2);
  const rehearsal = args.includes("--rehearsal") || args[0] === "rehearse";
  const [cmd, period, ...rest] = args.filter((a) => a !== "--rehearsal");
  if (cmd === "exceptions-rules" || cmd === "exceptions-run" || cmd === "exceptions-eval") return exceptions(cmd);
  if (!period) throw new Error("Usage: rehearse|run|list|approve|reject <YYYY-MM> ...");
  const dir = path.join(ROOT, "runs", rehearsal ? "coop-rehearsal" : "coop");
  const state = loadState(dir, period);

  if (cmd === "replay-reset") {
    // The snapshot saved right before the first approval; the replay is never executed (execute reads runs/coop only).
    const snap = JSON.parse(readFileSync(path.join(ROOT, "runs", "coop", `${period}.before-execute.json`), "utf8")) as CoopState;
    if (snap.period !== period || snap.drafts.some((d) => d.status !== "pending_approval")) {
      throw new Error("Snapshot is not an untouched pre-approval run");
    }
    updateState(path.join(ROOT, "runs", "coop-replay"), period, () => ({ ...snap, savedAt: snap.savedAt }));
    console.log(`Replay of ${period} reset: ${snap.drafts.length} drafts waiting for approval. Open /coop?source=replay`);
    return;
  }

  if (cmd === "rehearse" || cmd === "run") {
    const ledger = PaymentLedger.restore(sampleCoop.participants, noExecution, state?.drafts ?? []);
    // Read the meter file once: the run is computed from, and its saved hash describes, exactly this text.
    const meterText = readMeter(period);
    const month = parseMeterCsv(sampleCoop, period, meterText);
    let model;
    let name: string | null = null;
    if (cmd === "rehearse") model = scriptedCoopModel(sampleCoop, period, month);
    else {
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("Gemini key missing in .env.local");
      // One named model, no fallback restart after tool calls that changed the ledger.
      name = process.env.COOP_AGENT_MODEL ?? process.env.GEMINI_MODELS?.split(",")[0] ?? "gemini-3.5-flash-lite";
      model = google(name);
    }
    const result = await runCoopAgent({ group: sampleCoop, ledger, period, loadMonth: () => month, model });
    const next: CoopState = {
      period,
      savedAt: new Date().toISOString(),
      source: cmd === "rehearse" ? "scripted_rehearsal" : "agent",
      model: name,
      drafts: ledger.list(),
      queue: result.queue,
      problems: result.problems,
      inputs: billingInputs(sampleCoop, meterFileFor(period), meterText),
    };
    // The run takes a while; if anyone saved this period meanwhile, keep their changes and save nothing.
    updateState(dir, period, (cur) => {
      if ((cur?.savedAt ?? null) !== (state?.savedAt ?? null)) throw new Error(`${period} was saved by another process during the run; nothing saved`);
      return next;
    });
    print(next);
    return;
  }

  if (!state) throw new Error(`No saved state for ${period} in ${path.relative(ROOT, dir)}`);
  if (cmd === "list") return print(state);
  if (cmd === "execute") {
    if (rehearsal) throw new Error("Only the agent run can be executed, not the rehearsal");
    if (process.env.ALLOW_COOP_SANDBOX !== "true") throw new Error("Sandbox execution is on hold: set ALLOW_COOP_SANDBOX=true");
    const [draftId] = rest;
    const draft = state.drafts.find((d) => d.id === draftId);
    if (!draft) throw new Error(`Unknown draft ${draftId}`);
    if (draft.status !== "approved") throw new Error(`Draft ${draftId} is ${draft.status}; only approved drafts can be executed`);
    if (draft.kind === "bill" && (await findInvoiceByNumber(draft.statementId))) {
      throw new Error(`An invoice numbered ${draft.statementId} already exists in the sandbox; not creating another`);
    }
    const participants = withSandboxEmails(sampleCoop.participants);
    const to = participants.find((p) => p.id === draft.participantId)!;
    console.log(`Executing ${draft.kind} ${draft.id}: ${(draft.amountCents / 100).toFixed(2)} € to ${to.name} (sandbox ${to.email}), memo "${draft.memo}"`);
    // Under the account lock: re-checked as approved, checked against the daily limit of all months, and saved as
    // executing before PayPal is called.
    const done = await executeSavedDraft({ dir, period, draftId, participants, rail: paypalRail() });
    console.log(done.status === "executed" ? `Executed: ${JSON.stringify(done.result)}` : `FAILED (not retried): ${done.error}`);
    return;
  }
  if (cmd === "check" || cmd === "check-all") {
    // Read-only PayPal lookups; the comparison with the settlement is stored on each draft.
    const ids = cmd === "check" ? [rest[0]] : state.drafts.filter((d) => d.status === "executed").map((d) => d.id);
    const ledger = PaymentLedger.restore(sampleCoop.participants, noExecution, state.drafts);
    const recs = new Map<string, Reconciliation>();
    for (const id of ids) {
      const draft = ledger.get(id);
      if (!draft.result) throw new Error(`Draft ${id} has no execution result`);
      const rec =
        draft.kind === "bill"
          ? reconcileBill(draft, await getInvoice(draft.result.externalId), new Date())
          : reconcilePayout(draft, await getPayoutBatch(draft.result.externalId), new Date());
      recs.set(id, rec);
      console.log(`${id}: ${rec.status.toUpperCase()} — ${rec.reason} (PayPal ${rec.observed.externalStatus})`);
      if (draft.kind === "bill" && rec.status === "pending") {
        console.log(`  Pay (sandbox buyer): ${(await getInvoice(draft.result.externalId)).detail.metadata?.recipient_view_url ?? "no link"}`);
      }
    }
    // Only the reconciliations are written, onto the latest saved drafts.
    updateState(dir, period, (cur) => {
      const l = PaymentLedger.restore(sampleCoop.participants, noExecution, cur!.drafts);
      for (const [id, rec] of recs) l.recordReconciliation(id, rec);
      return { ...cur!, savedAt: new Date().toISOString(), drafts: l.list() };
    });
    return;
  }
  if (cmd === "approve" || cmd === "reject") {
    const [draftId, by, ...reason] = rest;
    if (!draftId || !by) throw new Error(`Usage: ${cmd} <YYYY-MM> <draftId> <your name>${cmd === "reject" ? " <reason>" : ""}`);
    const next = updateState(dir, period, (cur) => {
      const ledger = PaymentLedger.restore(sampleCoop.participants, noExecution, cur!.drafts);
      if (cmd === "approve") ledger.approve(draftId, by);
      else ledger.reject(draftId, by, reason.join(" ") || "no reason given");
      return { ...cur!, savedAt: new Date().toISOString(), drafts: ledger.list() };
    });
    return print(next);
  }
  throw new Error(`Unknown command ${cmd}`);
}

/**
 * Payment exception review over the fictional cases in exception-cases.ts. exceptions-rules saves the fixed rule
 * baseline (offline, not AI); exceptions-run lets Gemini propose (read and propose tools only, nothing executed).
 */
async function exceptions(cmd: "exceptions-rules" | "exceptions-run" | "exceptions-eval") {
  const runsDir = path.join(ROOT, "runs");
  if (cmd === "exceptions-rules") {
    saveExceptionRun(runsDir, ruleBaselineRun(EXCEPTION_CASES, new Date()));
    console.log("Saved the fixed rule baseline (not AI). Open /coop/exceptions?source=rules");
    return;
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("Gemini key missing in .env.local");
  const name = process.env.COOP_AGENT_MODEL ?? process.env.GEMINI_MODELS?.split(",")[0] ?? "gemini-3.5-flash-lite";
  if (cmd === "exceptions-eval") {
    // Held-out cases only, scored against the answer key frozen before the prompt revision. Not shown on the desk.
    const r = await runExceptionAgent({ cases: HOLDOUT_CASES, model: google(name) });
    const by = new Map(r.proposals.map((p) => [p.caseId, p]));
    const agent = scoreAccepted(HOLDOUT_CASES, HOLDOUT_EXPECTED, (x) => by.get(x.id)!.action);
    const rules = scoreAccepted(HOLDOUT_CASES, HOLDOUT_EXPECTED, ruleAction);
    const file = path.join(runsDir, "coop-exceptions-eval", `holdout-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ source: "agent", dataset: "synthetic_holdout", model: name, ranAt: new Date().toISOString(), agent, rules, ...r }, null, 2) + "\n");
    for (const x of HOLDOUT_CASES) {
      const p = by.get(x.id)!;
      console.log(`${x.id}: ${p.action} (${p.source}) expected ${HOLDOUT_EXPECTED[x.id].join("/")} · rule ${ruleAction(x)}${p.refused ? ` refused: ${p.refused}` : ""}`);
    }
    console.log(`Agent ${agent.correct}/${agent.total} (misses ${agent.misses.join(", ") || "none"}) · rules ${rules.correct}/${rules.total}`);
    console.log(`Usage: ${r.usage.steps} steps, ${r.usage.inputTokens} input tokens, ${r.usage.outputTokens} output tokens`);
    if (r.problems.length) console.log(`Problems: ${r.problems.join("; ")}`);
    console.log(`Saved ${path.relative(ROOT, file)}`);
    return;
  }
  const r = await runExceptionAgent({ cases: EXCEPTION_CASES, model: google(name) });
  saveExceptionRun(runsDir, { runId: newRunId(), source: "agent", dataset: "synthetic_cases", savedAt: new Date().toISOString(), model: name, ...r, reviews: {} });
  for (const p of r.proposals) console.log(`${p.caseId}: ${p.action} (${p.source})${p.refused ? ` refused: ${p.refused}` : ""}`);
  console.log(`Usage: ${r.usage.steps} steps, ${r.usage.inputTokens} input tokens, ${r.usage.outputTokens} output tokens`);
  if (r.problems.length) console.log(`Problems: ${r.problems.join("; ")}`);
  console.log("Open /coop/exceptions?source=agent");
}

function print(s: CoopState) {
  console.log(`${s.period} · ${s.source}${s.model ? ` (${s.model})` : ""} · saved ${s.savedAt}`);
  for (const q of s.queue) {
    const d = s.drafts.find((x) => x.id === q.facts.draftId);
    console.log(`\n[${d?.status}] ${q.facts.draftId}  ${q.facts.amountEur} €`);
    console.log(`  ${q.summary}`);
    console.log(`  summary: ${q.summarySource}${q.noteRejected ? ` (agent note rejected: ${q.noteRejected})` : ""}`);
    if (q.facts.flags.length) console.log(`  flags: ${q.facts.flags.map((f) => f.code).join(", ")}`);
  }
  if (s.problems.length) console.log(`\nProblems: ${s.problems.join("; ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
