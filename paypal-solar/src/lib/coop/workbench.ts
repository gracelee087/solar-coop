import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { checkBill, loadMeterMonth, paymentState, type MeterMonth } from "./billing-check";
import { dirFor, toDeskView, type DeskSource } from "./desk";
import { savedProposal, savedRunStatus, SAVED_RUN } from "./saved-proposal";
import { sampleCoop } from "./sample-group";
import { loadState, statePath, withLock, type CoopState } from "./state";
import { CLOSED_STATUSES, EVIDENCE_SOURCES, type CaseStatus, type Investigation, type WorkCase, type WorkItem, type WorkbenchView, type WorkTarget } from "./workbench-types";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const empty = (): WorkCase => ({ messages: [], status: "open", history: [] });
const targetSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), source: z.enum(["agent", "replay", "rehearsal"]), draftId: z.string().min(1).max(80) });
const actionSchema = targetSchema.extend({
  action: z.enum(["message", "prepare", "review", "evidence", "hold", "explain", "confirm", "close"]), version: z.string().length(64), by: z.string().trim().min(1).max(60),
  text: z.string().trim().max(2000).optional(), topic: z.enum(["amount", "meter", "already_paid"]).optional(), hold: z.enum(["external", "correction"]).optional(),
  origin: z.enum(["metering_operator", "grid_operator", "paypal", "customer", "internal"]).optional(), reference: z.string().trim().max(80).optional(),
});
export const investigationSchema = z.object({
  reason: z.string().trim().min(1).max(800), evidence: z.array(z.string().max(20)).min(1).max(20),
  unverified: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  checks: z.array(z.string().trim().min(1).max(300)).min(1).max(8), replyDraft: z.string().trim().min(1).max(1500),
}).strict();
const fileFor = (runs: string, target: Pick<WorkTarget, "source" | "period">) => path.join(runs, "coop-workbench", `${target.source}-${target.period}.json`);
// Cases saved before disputes had a topic were payment claims; their old statuses map onto the new ones.
const legacyStatus: Record<string, CaseStatus> = { awaiting_evidence: "investigating", resolved: "closed_operator_reviewed" };
function readCases(runs: string, target: Pick<WorkTarget, "source" | "period">): Record<string, WorkCase> {
  const file = fileFor(runs, target);
  const cases: Record<string, WorkCase> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (const c of Object.values(cases)) {
    c.status = legacyStatus[c.status] ?? c.status;
    if (c.messages.length && !c.topic) c.topic = "already_paid";
  }
  return cases;
}
function writeCases(runs: string, target: WorkTarget, cases: Record<string, WorkCase>) {
  const file = fileFor(runs, target);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cases, null, 2) + "\n");
  renameSync(tmp, file);
}
const CHAIN_IDS = { meter: "C1", allocation: "C2", bill: "C3", payment: "C4" } as const;
export const isClosed = (s: CaseStatus) => CLOSED_STATUSES.includes(s);
export function makeView(state: CoopState, source: DeskSource, cases: Record<string, WorkCase>, meter: MeterMonth | null = null): WorkbenchView {
  const desk = toDeskView(state, source);
  const items: WorkItem[] = desk.items.map((item) => {
    const draft = state.drafts.find((d) => d.id === item.draftId)!;
    const work = cases[item.draftId] ?? empty();
    const facts = state.queue.find((q) => q.facts.draftId === item.draftId)!.facts;
    const chain = draft.kind === "bill" ? checkBill({ group: sampleCoop, period: state.period, draft, facts, meter, recorded: state.inputs }) : undefined;
    const basis = hash({ draft, settlement: item, messages: work.messages, manual: work.evidence ?? [], chain });
    return { ...item, statementId: draft.statementId, work, basis, version: hash({ draft, settlement: item, work, chain }),
      proposalStale: !!work.proposal && work.proposal.basis !== basis, chain, payment: paymentState(draft),
      evidence: [
        { id: "F1", kind: "fact", text: `Statement ${draft.statementId}; ${item.name}; ${item.amountEur} EUR; ${state.period}.` },
        { id: "F2", kind: "fact", text: `Settlement: ${item.kWh} kWh at ${item.priceCt} ct/kWh (display rounded; amount computed from integer Wh).` },
        { id: "F3", kind: "fact", text: `Ledger state: ${draft.status}. ${draft.approval ? `Approved by ${draft.approval.by} at ${draft.approval.at}.` : "No approval recorded."}` },
        { id: "F4", kind: "fact", text: draft.reconciliation
          ? `Saved provider observation: ${draft.reconciliation.observed.externalStatus}; reconciliation ${draft.reconciliation.status}; ${draft.reconciliation.reason}; checked ${draft.reconciliation.checkedAt}.`
          : `No reconciliation recorded. ${draft.result ? `Execution result: ${draft.result.status}, reference ${draft.result.externalId}.` : "No provider result recorded."}` },
        { id: "F5", kind: "fact", text: "Bank account check: not connected. Customer messages do not confirm a payment." },
        ...(chain ? chain.links.map((l) => ({ id: CHAIN_IDS[l.step], kind: "fact" as const, text: `${l.step} check (${l.status.replaceAll("_", " ")}): ${l.text}` })) : []),
        ...work.messages.map((m) => ({ id: m.id, kind: "claim" as const, text: m.text })),
        ...(work.evidence ?? []).map((e) => ({ id: e.id, kind: "manual" as const,
          text: `Entered by ${e.by} (not verified by the system): ${EVIDENCE_SOURCES[e.source]}${e.reference ? `, reference ${e.reference}` : ""}: ${e.text}` })),
      ],
    };
  });
  const matched = items.filter((i) => i.status === "executed" && i.reconciliation?.status === "matched").length;
  // A previously resolved case reopens logically if the ledger changes; never silently close a new mismatch.
  // A closed payment claim reopens if the payment is no longer matched.
  const openCases = items.filter((i) => i.work.messages.length > 0 && (!isClosed(i.work.status) || i.proposalStale
    || (i.work.topic === "already_paid" && i.payment.status !== "paid"))).length;
  const closingNotes = [...desk.problems];
  if (state.drafts.some((d) => !items.some((i) => i.draftId === d.id))) closingNotes.push("Additional ledger entries (including refunds) need a separate review before closing.");
  if (Object.entries(cases).some(([id, c]) => c.messages.length && !items.some((i) => i.draftId === id))) closingNotes.push("A customer case is attached to a statement no longer in this queue. Check the saved case records.");
  return { desk, items, closingNotes, counts: { review: desk.counts.pending, matched, unmatched: items.length - matched, openCases,
    readyToClose: items.length > 0 && matched === items.length && openCases === 0 && closingNotes.length === 0 } };
}
/** `root` holds the meter files (src/data); by default the parent of `runs`. */
export function loadWorkbench(runs: string, period: string, source?: DeskSource, root = path.dirname(runs)): WorkbenchView | null {
  // Validate before deriving any paths, including callers outside the HTTP route.
  for (const s of source ? [source] : ["agent", "rehearsal"] as const) {
    targetSchema.parse({ period, source: s, draftId: "read" });
    const state = loadState(dirFor(runs, s), period);
    if (state) return makeView(state, s, readCases(runs, { period, source: s }), loadMeterMonth(root, sampleCoop, period));
  }
  return null;
}
const kwh = (wh: number) => (wh / 1000).toFixed(1);
const messageIds = (item: WorkItem) => [...item.work.messages.map((m) => m.id), ...(item.work.evidence ?? []).map((e) => e.id)];
export function templateInvestigation(item: WorkItem): Investigation {
  const chain = item.chain;
  if (item.work.topic === "already_paid" || !chain) {
    return {
      reason: "A customer message needs an operator check against this statement and the saved provider record.",
      evidence: ["F1", "F4", "F5", ...messageIds(item)],
      unverified: ["The customer's account of the payment has not been independently verified."],
      checks: ["Compare the statement reference, amount and period with the message.", "Check the payment date and payer name in the provider or bank record.", "If payment covers more than one bill, confirm the allocation before changing any records."],
      replyDraft: `Hello ${item.name}, thank you for your message about ${item.statementId} (${item.amountEur} EUR). To help us check it, please confirm the payment date, payer name, amount, reference and which billing period(s) it covers. We will compare these with our records.`,
    };
  }
  const a = chain.allocation;
  const evidence = ["F1", "F2", "C1", "C2", "C3", ...messageIds(item)].filter((id) => item.evidence.some((e) => e.id === id));
  if (chain.billStatus !== "match" || !a || !chain.meter) {
    return {
      reason: `The bill check is ${chain.billStatus.replaceAll("_", " ")}, so the bill cannot be explained as correct yet.`,
      evidence,
      unverified: ["Whether the recorded bill agrees with the meter data and contract terms."],
      checks: ["Find which link of the bill check differs (meter file, allocation, billed kWh, price or amount).", "If the bill is wrong, record that a corrected statement is needed; do not change the sent invoice here."],
      replyDraft: `Hello ${item.name}, thank you for your message about ${item.statementId}. We are checking the metered values and the calculation behind this bill and will come back to you.`,
    };
  }
  return {
    reason: `The customer questions the billed energy. The meter recorded ${kwh(chain.meter.consumptionWh)} kWh in total, but only the shared solar part is billed here: ${chain.bill.recordedKWh} kWh. The remaining ${kwh(a.residualWh)} kWh came from the household's own supplier.`,
    evidence,
    unverified: ["Whether the customer's own meter reading matches the metering operator's data has not been checked.", "Which total the customer compared the bill with is not known."],
    checks: ["Ask which reading or total the customer compared with, and for which period.", "If their reading differs from the meter file, ask the metering operator to confirm the values.", "Explain that consumption outside the shared solar is billed by their own supplier."],
    replyDraft: `Hello ${item.name}, thank you for your message about ${item.statementId}. In ${chain.period} your meter recorded ${kwh(chain.meter.consumptionWh)} kWh. Of this, ${chain.bill.recordedKWh} kWh was shared solar energy from the group, billed at ${chain.bill.recordedPriceCt} ct/kWh = ${item.amountEur} EUR. The other ${kwh(a.residualWh)} kWh (${kwh(a.residualNoPoolWh)} kWh at times without shared solar, such as at night) came from your own electricity supplier and is billed by them, not on this statement. If your own reading differs, please send it with the date and we will check it with the metering operator.`,
  };
}
export function validateInvestigation(item: WorkItem, proposal: Investigation): void {
  investigationSchema.parse(proposal);
  const ids = new Set(item.evidence.map((e) => e.id));
  if (proposal.evidence.some((id) => !ids.has(id))) throw new Error("Proposal cites unknown evidence");
  if (item.work.topic !== "already_paid" && item.chain) {
    if (!proposal.evidence.includes("C3")) throw new Error("The bill check (C3) must be cited");
  } else if (!proposal.evidence.includes("F4") || !proposal.evidence.includes("F5")) throw new Error("Provider and bank limitations must be cited");
  if (!item.work.messages.every((m) => proposal.evidence.includes(m.id))) throw new Error("Every customer message must be cited");
  if (proposal.unverified.some((s) => /^(none|n\/?a|nothing|no|[-—])\.?$/i.test(s.trim()))) throw new Error("Unverified items cannot be placeholders");
}
function mutate(runs: string, target: WorkTarget, change: (item: WorkItem) => WorkCase, root = path.dirname(runs)): WorkbenchView {
  targetSchema.parse(target);
  // The same state lock used by approval and reconciliation prevents accepting a proposal against an old payment.
  return withLock(`${statePath(dirFor(runs, target.source), target.period)}.lock`, "Monthly workbench", () => {
    const state = loadState(dirFor(runs, target.source), target.period);
    if (!state) throw new Error("No saved month; start an offline rehearsal first");
    const cases = readCases(runs, target);
    const meter = loadMeterMonth(root, sampleCoop, target.period);
    const item = makeView(state, target.source, cases, meter).items.find((i) => i.draftId === target.draftId);
    if (!item) throw new Error("Unknown statement");
    cases[target.draftId] = change(item);
    writeCases(runs, target, cases);
    return makeView(state, target.source, cases, meter);
  });
}
export function workbenchAction(runs: string, body: unknown, now = new Date(), root = path.dirname(runs)): WorkbenchView {
  const b = actionSchema.parse(body);
  return mutate(runs, b, (item) => {
    if (item.version !== b.version) throw new Error("This statement changed. Refresh and review the latest version.");
    const work = structuredClone(item.work);
    const at = now.toISOString();
    const need = (what: string) => { if (!b.text) throw new Error(what); };
    let detail = b.text;
    if (b.action === "message") {
      need("Enter the customer's message");
      if (work.messages.length >= 12) throw new Error("This case has reached the 12-message limit");
      if (!work.messages.length) {
        if (!b.topic) throw new Error("Choose what the customer disputes");
        if (b.topic !== "already_paid" && item.kind !== "bill") throw new Error("Only a bill can be disputed for its amount or metered energy");
        work.topic = b.topic;
      }
      work.messages.push({ id: `N${work.messages.length + 1}`, text: b.text!, by: b.by, at });
      work.status = "open";
    } else if (b.action === "prepare") {
      if (!work.messages.length) throw new Error("Add a customer message first");
      if (isClosed(work.status) && !item.proposalStale) throw new Error("This case is closed. Add a new customer message to reopen it.");
      // A saved real AI proposal is reused only when this case is exactly the input the recorded run saw.
      const saved = savedRunStatus(item, b.period);
      if (saved === "match") {
        const proposal = savedProposal();
        validateInvestigation(item, proposal);
        work.proposal = { ...proposal, source: "agent", model: SAVED_RUN.model, basis: item.basis, at, saved: { ranAt: SAVED_RUN.ranAt } };
        detail = `Loaded the saved real AI agent proposal (one recorded run, ${SAVED_RUN.ranAt}); this case is identical to its input. No model was called.`;
      } else {
        const proposal = templateInvestigation(item);
        validateInvestigation(item, proposal);
        work.proposal = { ...proposal, source: "template", basis: item.basis, at };
        detail = "Prepared an offline checklist and unsent reply template." +
          (saved === "differs" ? " The saved AI proposal was not used: this case differs from the input of the recorded run." : "");
      }
      // A new proposal is acted on only after a person reviews it.
      work.status = "open";
    } else if (b.action === "review") {
      if (!work.proposal || item.proposalStale) throw new Error("Prepare a fresh investigation before reviewing");
      if (work.status !== "open") throw new Error("This investigation was already reviewed");
      need("Record what you will check next");
      work.status = "investigating";
    } else if (b.action === "evidence") {
      if (!work.messages.length) throw new Error("Add a customer message first");
      if (isClosed(work.status)) throw new Error("This case is closed. Add a new customer message to reopen it.");
      if (!b.origin) throw new Error("Choose where the evidence comes from");
      need("Summarise what the evidence says");
      const list = work.evidence ?? [];
      if (list.length >= 12) throw new Error("This case has reached the 12-evidence limit");
      work.evidence = [...list, { id: `E${list.length + 1}`, source: b.origin, ...(b.reference ? { reference: b.reference } : {}), text: b.text!, by: b.by, at }];
      // New evidence reopens the review: an explanation or hold made before it no longer stands on its own.
      if (work.status !== "open") work.status = "investigating";
      detail = `Manual evidence E${list.length + 1} from ${EVIDENCE_SOURCES[b.origin]}${b.reference ? ` (${b.reference})` : ""}: ${b.text}`;
    } else if (b.action === "hold") {
      if (!(["investigating", "waiting_external", "correction_needed", "explained_awaiting_reply"] as CaseStatus[]).includes(work.status)) throw new Error("Review the investigation before putting the case on hold");
      if (!b.hold) throw new Error("Choose why the case is on hold");
      need(b.hold === "external" ? "Record whose answer you are waiting for" : "Record what needs to be corrected");
      // Both stay open: an external answer or a corrected statement is still outstanding.
      work.status = b.hold === "external" ? "waiting_external" : "correction_needed";
    } else if (b.action === "explain") {
      if (work.topic === "already_paid") throw new Error("A payment claim is closed by a matched payment, not by an explanation");
      if (!(["investigating", "waiting_external"] as CaseStatus[]).includes(work.status) || item.proposalStale) throw new Error("Review a current investigation before sending an explanation");
      if (item.chain?.billStatus !== "match") throw new Error("The bill check does not confirm this bill. Record a correction or an external check instead.");
      need("Record the explanation you sent");
      work.status = "explained_awaiting_reply";
    } else if (b.action === "confirm") {
      if (work.status !== "explained_awaiting_reply") throw new Error("Send an explanation before recording the customer's confirmation");
      if (item.proposalStale || item.chain?.billStatus !== "match") throw new Error("The statement, evidence or bill check changed since the explanation. Review the case again.");
      need("Record what the customer confirmed and how (e-mail, phone, letter)");
      work.status = "closed_customer_confirmed";
    } else {
      need("Record why the case is closed");
      if (work.topic === "already_paid") {
        if (!(["investigating", "waiting_external"] as CaseStatus[]).includes(work.status) || item.proposalStale) throw new Error("Review a current investigation before closing");
        if (item.payment.status !== "paid") throw new Error("Payment is not reconciled. A claim or review cannot mark it as paid.");
      } else if (work.status !== "explained_awaiting_reply") throw new Error("Send an explanation before closing; a needed correction or external check keeps the case open");
      else if (item.proposalStale || item.chain?.billStatus !== "match") throw new Error("The statement, evidence or bill check changed since the explanation. Review the case again.");
      work.status = "closed_operator_reviewed";
    }
    work.history.push({ event: b.action === "hold" ? `hold_${b.hold}` : b.action, by: b.by, at, detail: detail! });
    return work;
  }, root);
}
export function saveInvestigation(runs: string, target: WorkTarget, basis: string, proposal: Investigation, model: string): WorkbenchView {
  return mutate(runs, target, (item) => {
    if (item.basis !== basis) throw new Error("Statement or messages changed during the model run; proposal was not saved");
    if (!item.work.messages.length || isClosed(item.work.status)) throw new Error("An open customer case is required");
    validateInvestigation(item, proposal);
    const at = new Date().toISOString();
    return { ...item.work, status: "open", proposal: { ...proposal, basis, source: "agent", model, at }, history: [...item.work.history, { event: "agent_proposal", by: model, at, detail: "AI proposed an investigation. No payment or message was sent." }] };
  });
}
