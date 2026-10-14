import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dirFor, toDeskView, type DeskSource } from "./desk";
import { loadState, statePath, withLock, type CoopState } from "./state";
import type { Investigation, WorkCase, WorkItem, WorkbenchView, WorkTarget } from "./workbench-types";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const empty = (): WorkCase => ({ messages: [], status: "open", history: [] });
const targetSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), source: z.enum(["agent", "replay", "rehearsal"]), draftId: z.string().min(1).max(80) });
const actionSchema = targetSchema.extend({ action: z.enum(["message", "prepare", "review", "resolve"]), version: z.string().length(64), by: z.string().trim().min(1).max(60), text: z.string().trim().max(2000).optional() });
export const investigationSchema = z.object({
  reason: z.string().trim().min(1).max(800), evidence: z.array(z.string().max(20)).min(1).max(20),
  unverified: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  checks: z.array(z.string().trim().min(1).max(300)).min(1).max(8), replyDraft: z.string().trim().min(1).max(1500),
}).strict();
const fileFor = (runs: string, target: Pick<WorkTarget, "source" | "period">) => path.join(runs, "coop-workbench", `${target.source}-${target.period}.json`);
function readCases(runs: string, target: Pick<WorkTarget, "source" | "period">): Record<string, WorkCase> {
  const file = fileFor(runs, target);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}
function writeCases(runs: string, target: WorkTarget, cases: Record<string, WorkCase>) {
  const file = fileFor(runs, target);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cases, null, 2) + "\n");
  renameSync(tmp, file);
}
export function makeView(state: CoopState, source: DeskSource, cases: Record<string, WorkCase>): WorkbenchView {
  const desk = toDeskView(state, source);
  const items: WorkItem[] = desk.items.map((item) => {
    const draft = state.drafts.find((d) => d.id === item.draftId)!;
    const work = cases[item.draftId] ?? empty();
    const basis = hash({ draft, settlement: item, messages: work.messages });
    return { ...item, statementId: draft.statementId, work, basis, version: hash({ draft, settlement: item, work }),
      proposalStale: !!work.proposal && work.proposal.basis !== basis,
      evidence: [
        { id: "F1", kind: "fact", text: `Statement ${draft.statementId}; ${item.name}; ${item.amountEur} EUR; ${state.period}.` },
        { id: "F2", kind: "fact", text: `Settlement: ${item.kWh} kWh at ${item.priceCt} ct/kWh (display rounded; amount computed from integer Wh).` },
        { id: "F3", kind: "fact", text: `Ledger state: ${draft.status}. ${draft.approval ? `Approved by ${draft.approval.by} at ${draft.approval.at}.` : "No approval recorded."}` },
        { id: "F4", kind: "fact", text: draft.reconciliation
          ? `Saved provider observation: ${draft.reconciliation.observed.externalStatus}; reconciliation ${draft.reconciliation.status}; ${draft.reconciliation.reason}; checked ${draft.reconciliation.checkedAt}.`
          : `No reconciliation recorded. ${draft.result ? `Execution result: ${draft.result.status}, reference ${draft.result.externalId}.` : "No provider result recorded."}` },
        { id: "F5", kind: "fact", text: "Bank account check: not connected. Customer messages do not confirm a payment." },
        ...work.messages.map((m) => ({ id: m.id, kind: "claim" as const, text: m.text })),
      ],
    };
  });
  const matched = items.filter((i) => i.status === "executed" && i.reconciliation?.status === "matched").length;
  // A previously resolved case reopens logically if the ledger changes; never silently close a new mismatch.
  const openCases = items.filter((i) => i.work.messages.length > 0 && (i.work.status !== "resolved" || i.proposalStale || i.reconciliation?.status !== "matched")).length;
  const closingNotes = [...desk.problems];
  if (state.drafts.some((d) => !items.some((i) => i.draftId === d.id))) closingNotes.push("Additional ledger entries (including refunds) need a separate review before closing.");
  if (Object.entries(cases).some(([id, c]) => c.messages.length && !items.some((i) => i.draftId === id))) closingNotes.push("A customer case is attached to a statement no longer in this queue. Check the saved case records.");
  return { desk, items, closingNotes, counts: { review: desk.counts.pending, matched, unmatched: items.length - matched, openCases,
    readyToClose: items.length > 0 && matched === items.length && openCases === 0 && closingNotes.length === 0 } };
}
export function loadWorkbench(runs: string, period: string, source?: DeskSource): WorkbenchView | null {
  // Validate before deriving any paths, including callers outside the HTTP route.
  for (const s of source ? [source] : ["agent", "rehearsal"] as const) {
    targetSchema.parse({ period, source: s, draftId: "read" });
    const state = loadState(dirFor(runs, s), period);
    if (state) return makeView(state, s, readCases(runs, { period, source: s }));
  }
  return null;
}
export function templateInvestigation(item: WorkItem): Investigation {
  return {
    reason: "A customer message needs an operator check against this statement and the saved provider record.",
    evidence: ["F1", "F4", "F5", ...item.work.messages.map((m) => m.id)],
    unverified: ["The customer's account of the payment has not been independently verified."],
    checks: ["Compare the statement reference, amount and period with the message.", "Check the payment date and payer name in the provider or bank record.", "If payment covers more than one bill, confirm the allocation before changing any records."],
    replyDraft: `Hello ${item.name}, thank you for your message about ${item.statementId} (${item.amountEur} EUR). To help us check it, please confirm the payment date, payer name, amount, reference and which billing period(s) it covers. We will compare these with our records.`,
  };
}
export function validateInvestigation(item: WorkItem, proposal: Investigation): void {
  investigationSchema.parse(proposal);
  const ids = new Set(item.evidence.map((e) => e.id));
  if (proposal.evidence.some((id) => !ids.has(id))) throw new Error("Proposal cites unknown evidence");
  if (!proposal.evidence.includes("F4") || !proposal.evidence.includes("F5")) throw new Error("Provider and bank limitations must be cited");
  if (!item.work.messages.every((m) => proposal.evidence.includes(m.id))) throw new Error("Every customer message must be cited");
  if (proposal.unverified.some((s) => /^(none|n\/?a|nothing|no|[-—])\.?$/i.test(s.trim()))) throw new Error("Unverified items cannot be placeholders");
}
function mutate(runs: string, target: WorkTarget, change: (item: WorkItem) => WorkCase): WorkbenchView {
  targetSchema.parse(target);
  // The same state lock used by approval and reconciliation prevents accepting a proposal against an old payment.
  return withLock(`${statePath(dirFor(runs, target.source), target.period)}.lock`, "Monthly workbench", () => {
    const state = loadState(dirFor(runs, target.source), target.period);
    if (!state) throw new Error("No saved month; start an offline rehearsal first");
    const cases = readCases(runs, target);
    const item = makeView(state, target.source, cases).items.find((i) => i.draftId === target.draftId);
    if (!item) throw new Error("Unknown statement");
    cases[target.draftId] = change(item);
    writeCases(runs, target, cases);
    return makeView(state, target.source, cases);
  });
}
export function workbenchAction(runs: string, body: unknown, now = new Date()): WorkbenchView {
  const b = actionSchema.parse(body);
  return mutate(runs, b, (item) => {
    if (item.version !== b.version) throw new Error("This statement changed. Refresh and review the latest version.");
    const work = structuredClone(item.work);
    const at = now.toISOString();
    if (b.action === "message") {
      if (!b.text) throw new Error("Enter the customer's message");
      if (work.messages.length >= 12) throw new Error("This case has reached the 12-message limit");
      work.messages.push({ id: `N${work.messages.length + 1}`, text: b.text, by: b.by, at });
      work.status = "open";
    } else if (b.action === "prepare") {
      if (!work.messages.length) throw new Error("Add a customer message first");
      const proposal = templateInvestigation(item);
      validateInvestigation(item, proposal);
      work.proposal = { ...proposal, source: "template", basis: item.basis, at };
      work.status = "open";
    } else if (b.action === "review") {
      if (!work.proposal || item.proposalStale) throw new Error("Prepare a fresh investigation before reviewing");
      if (work.status !== "open") throw new Error("This investigation was already reviewed");
      if (!b.text) throw new Error("Record what you will check next");
      work.status = "awaiting_evidence";
    } else {
      if (work.status !== "awaiting_evidence" || item.proposalStale) throw new Error("Review a current investigation before resolving");
      if (item.status !== "executed" || item.reconciliation?.status !== "matched") throw new Error("Payment is not reconciled. A claim or review cannot mark it as paid.");
      if (!b.text) throw new Error("Record why the case is resolved");
      work.status = "resolved";
    }
    work.history.push({ event: b.action, by: b.by, at, detail: b.text ?? "Prepared an offline checklist and unsent reply template." });
    return work;
  });
}
export function saveInvestigation(runs: string, target: WorkTarget, basis: string, proposal: Investigation, model: string): WorkbenchView {
  return mutate(runs, target, (item) => {
    if (item.basis !== basis) throw new Error("Statement or messages changed during the model run; proposal was not saved");
    if (!item.work.messages.length || item.work.status !== "open") throw new Error("An open customer case is required");
    validateInvestigation(item, proposal);
    const at = new Date().toISOString();
    return { ...item.work, proposal: { ...proposal, basis, source: "agent", model, at }, history: [...item.work.history, { event: "agent_proposal", by: model, at, detail: "AI proposed an investigation. No payment or message was sent." }] };
  });
}
