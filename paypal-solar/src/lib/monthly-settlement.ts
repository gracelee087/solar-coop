import { checkAgreement, type Agreement } from "./agreement";
import { allocateAll, monthlyTotals } from "./allocate";
import { validateJuneIntervals } from "./data-validation";
import { classifyInvoiceInput, settlementKey, verifyInvoice, type InvoiceInput } from "./invoice";
import type { IssuedInvoice } from "./issued";
import type { PayPalInvoice } from "./paypal-api";
import { monthlyEconomics } from "./pricing";
import type { SettlementResult } from "./settlement-agent";
import type { PricingSettings } from "./tariffs";
import type { Interval, SharingGroup } from "./types";
import { evidenceDigest, evidenceProblems, evidenceTag, latestEvidence, missingEvidence, type EvidenceTag } from "./case-evidence";

export type MonthState = "ready" | "awaiting_check" | "awaiting_payment" | "paid" | "no_invoice" | "needs_review";
export interface MonthItem {
  caseId: string;
  /** Append-only observations; the last tag for a kind is the current observation. */
  evidence: EvidenceTag[];
  householdId: string;
  name: string;
  input: InvoiceInput | null;
  state: MonthState;
  invoiceId: string | null;
  recordedNumber: string | null;
  problems: string[];
}
export interface MonthPlan { period: string; items: MonthItem[]; problems: string[] }
export interface MonthEvent { at: string; action: string; householdId?: string; detail: string; evidence?: EvidenceTag }
export interface MonthReport extends MonthPlan {
  execution: "local_preview" | "simulated" | "sandbox_agent";
  finished: boolean;
  /** Operational attention required, NOT measured human labour or clicks. */
  reviewRequired: number;
  paidCount: number;
  pendingCount: number;
  events: MonthEvent[];
}

/** Fixed June prototype. Validate the whole meter series before preparing any bill. No external calls. */
export function prepareMonth(args: {
  period: string; group: SharingGroup; intervals: Interval[]; settings: PricingSettings;
  emails: Record<string, string>; findAgreement: (key: string) => Agreement | null;
  findIssued: (key: string) => IssuedInvoice | null;
  now?: () => string;
  sources?: { agreement: string; usage: string; invoiceRecord: string };
}): MonthPlan {
  const { period, group } = args;
  const plan: MonthPlan = { period, items: [], problems: [] };
  try {
    if (period !== "2026-06") throw new Error("Only the modelled June 2026 dataset is supported");
    validateJuneIntervals(group, args.intervals);
    const totals = monthlyTotals(group, args.intervals, allocateAll(group, args.intervals));
    const observedAt = args.now?.() ?? new Date().toISOString();
    const usageDigest = evidenceDigest(args.intervals);
    for (const h of group.households) {
      const key = settlementKey(period, group.producer.id, h.id);
      const item: MonthItem = { caseId: key, evidence: missingEvidence(key, observedAt), householdId: h.id, name: h.name, input: null, state: "needs_review", invoiceId: null, recordedNumber: null, problems: [] };
      plan.items.push(item);
      const usage = evidenceTag({ caseId: key, kind: "usage", status: "checked", observedAt, source: args.sources?.usage ?? "prepareMonth: validated input intervals → allocateAll → monthlyTotals", environment: "modelled",
        snapshot: { period, householdId: h.id, group, intervalCount: args.intervals.length, first: args.intervals[0].start, last: args.intervals[args.intervals.length - 1].start, intervalsSha256: usageDigest, sharedWh: totals.sharedWh[h.id] },
        note: "Validated modelled usage, not a utility-certified meter reading. Hash identifies the exact input series; snapshot contains its summary." });
      item.evidence.push(usage);
      try {
        const agreement = args.findAgreement(key);
        if (!agreement) throw new Error(`No saved agreement for ${key}`);
        item.problems.push(...checkAgreement(agreement, group, period));
        if (agreement.settlementKey !== key) item.problems.push("Agreement stored under the wrong household key");
        const w = agreement.basis.window;
        if (!Number.isFinite(w.floorCt) || !Number.isFinite(w.ceilingCt) || w.floorCt > w.ceilingCt) item.problems.push("Invalid agreement price window");
        const agreementEvidence = evidenceTag({ caseId: key, kind: "agreement", status: item.problems.length ? "mismatch" : "checked", observedAt, source: args.sources ? `${args.sources.agreement}#/agreements/${key}` : `findAgreement(${key})`, environment: "local_record", snapshot: agreement, note: item.problems.join("; ") || "Saved demo agreement matches this period, household and allocation. Not a signed legal contract." });
        item.evidence.push(agreementEvidence);
        const email = args.emails[h.id], producerEmail = args.emails[group.producer.id];
        if (![email, producerEmail].every((x) => typeof x === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) item.problems.push("Missing or invalid billing email");
        if (item.problems.length) continue;
        const e = monthlyEconomics(totals.sharedWh[h.id], agreement.priceCt, args.settings);
        const input: InvoiceInput = {
          producer: { name: group.producer.name, email: producerEmail }, consumer: { name: h.name, email },
          period, sharedKWh: e.sharedKWh, priceCt: agreement.priceCt, amountCents: e.energyChargeCents,
          invoiceNumber: key, invoiceDate: "2026-07-01",
        };
        item.input = input;
        const check = classifyInvoiceInput(input);
        if (check.kind === "invalid") { item.problems.push(...check.problems); continue; }
        item.evidence.push(evidenceTag({ caseId: key, kind: "calculation", status: "checked", observedAt, source: "monthlyEconomics + classifyInvoiceInput", environment: "modelled", snapshot: input, dependsOn: [usage.id, agreementEvidence.id], note: "Neighbour energy charge only. This is not a supplier/grid bill or proof of tax payment." }));
        // Consult the old ledger even for zero: a historical charge for this month must not be hidden.
        const issued = args.findIssued(key);
        if (issued) {
          item.invoiceId = issued.invoiceId;
          item.recordedNumber = issued.invoiceNumber;
          const differs = !issued.invoiceId || !issued.invoiceNumber || issued.priceCt !== input.priceCt || issued.sharedKWh !== input.sharedKWh || issued.amountEur !== (input.amountCents / 100).toFixed(2);
          item.evidence.push(evidenceTag({ caseId: key, kind: "invoice_record", status: differs ? "mismatch" : "checked", observedAt, source: args.sources ? `${args.sources.invoiceRecord}#/settlements/${key}` : `findIssued(${key})`, environment: "local_record", snapshot: issued, note: "Historical local invoice record; not a fresh PayPal payment check." }));
          if (differs) {
            item.problems.push(`Earlier invoice ${issued.invoiceNumber} differs from the saved terms or calculated amount; do not bill again`);
            continue;
          }
          item.state = "awaiting_check";
        } else item.state = check.kind === "nothing_to_bill" ? "no_invoice" : "ready";
      } catch (e) { item.problems.push((e as Error).message); }
    }
  } catch (e) { plan.problems.push((e as Error).message); plan.items = []; }
  return plan;
}

export interface MonthDeps {
  execution: MonthReport["execution"];
  allowIssue: boolean;
  settle: (input: InvoiceInput, signal: AbortSignal) => Promise<SettlementResult>;
  getInvoice: (id: string) => Promise<PayPalInvoice>;
  now: () => string;
  /** Persist each event before a money-changing action. Throwing blocks that action. */
  record: (event: MonthEvent) => void;
}

/** All mutable state stays behind tools: the model supplies only a household ID, never prices or recipients. */
export function createMonthSession(plan: MonthPlan, deps: MonthDeps) {
  const snapshot = structuredClone(plan);
  const items = new Map(snapshot.items.map((i) => [i.householdId, i]));
  const events: MonthEvent[] = [];
  const busy = new Map<string, { action: string; promise: Promise<MonthItem> }>();
  let finished = false;
  const controller = new AbortController();
  const record = (action: string, detail: string, householdId?: string, evidence?: EvidenceTag) => {
    const event = { at: deps.now(), action, detail, ...(householdId ? { householdId } : {}), ...(evidence ? { evidence } : {}) };
    deps.record(event);
    events.push(event);
  };
  const persisted = new Set<string>();
  const persistEvidence = (item: MonthItem) => {
    for (const tag of item.evidence) if (!persisted.has(tag.id)) {
      record("evidence_collected", `${tag.kind}: ${tag.status}`, item.householdId, tag);
      persisted.add(tag.id);
    }
  };
  const requireBillEvidence = (item: MonthItem) => {
    const problems = evidenceProblems(item.caseId, item.evidence, ["agreement", "usage", "calculation"]);
    if (evidenceDigest(latestEvidence(item.evidence, "calculation")?.snapshot ?? null) !== evidenceDigest(item.input)) problems.push("Calculation evidence differs from the bill input");
    if (problems.length) { item.state = "needs_review"; item.problems.push(...problems); return false; }
    persistEvidence(item);
    return true;
  };
  const report = (): MonthReport => structuredClone({
    ...snapshot, items: [...items.values()], execution: deps.execution, finished,
    reviewRequired: snapshot.problems.length + [...items.values()].filter((i) => i.state === "needs_review").length,
    paidCount: [...items.values()].filter((i) => i.state === "paid").length,
    pendingCount: [...items.values()].filter((i) => i.state === "awaiting_payment").length,
    events,
  });
  const run = (id: string, action: string, fn: (item: MonthItem) => Promise<void>): Promise<MonthItem> => {
    const pending = busy.get(id);
    if (pending) return pending.action === action
      ? pending.promise.then((item) => structuredClone(item))
      : pending.promise.then(() => run(id, action, fn));
    const item = items.get(id);
    if (!item) return Promise.reject(new Error("Unknown household or invalid month"));
    if (finished || controller.signal.aborted) return Promise.resolve(structuredClone(item));
    if (snapshot.problems.length) return Promise.reject(new Error("Unknown household or invalid month"));
    const promise = (async () => {
      // Yield once so the lock exists before any callback can re-enter the session.
      await Promise.resolve();
      try { controller.signal.throwIfAborted(); await fn(item); }
      catch (e) { item.state = "needs_review"; item.problems.push(`${action}: ${(e as Error).message}`); }
      record(action, `${item.state}${item.problems.length ? ": " + item.problems.join("; ") : ""}`, id);
      return structuredClone(item);
    })().finally(() => busy.delete(id));
    busy.set(id, { action, promise });
    return promise;
  };
  return {
    signal: controller.signal,
    report,
    inspect: () => { for (const item of items.values()) persistEvidence(item); record("inspect_month", "Collected evidence for saved terms and modelled usage; external tax and refund sources remain unconnected"); return report(); },
    issue: (id: string) => run(id, "issue_invoice", async (item) => {
      if (item.state !== "ready" || !item.input) return;
      if (!requireBillEvidence(item)) return;
      if (!deps.allowIssue) { item.state = "needs_review"; item.problems.push("Invoice issuing is disabled for this run"); return; }
      record("issue_intent", item.input.invoiceNumber, id);
      // An uncertain failure must be reconciled on a later run, never blindly retried in this session.
      item.state = "needs_review";
      const result = await deps.settle(structuredClone(item.input), controller.signal);
      item.invoiceId = result.invoiceId;
      controller.signal.throwIfAborted();
      if (result.problems.length || !result.invoiceId || !["created", "existing", "resumed"].includes(result.outcome)) {
        item.problems.push(...(result.problems.length ? result.problems : [`Settlement stopped: ${result.outcome}`]));
        return;
      }
      item.state = "awaiting_check";
    }),
    check: (id: string) => run(id, "check_payment", async (item) => {
      if (item.state !== "awaiting_check" || !item.input || !item.invoiceId) return;
      if (!requireBillEvidence(item)) return;
      const inv = await deps.getInvoice(item.invoiceId);
      controller.signal.throwIfAborted();
      const problems = verifyInvoice(inv, { ...item.input, invoiceNumber: item.recordedNumber ?? item.input.invoiceNumber });
      if (inv.id !== item.invoiceId) problems.push("PayPal returned a different invoice ID");
      const money = (value?: string) => typeof value === "string" && /^\d+\.\d{2}$/.test(value) ? Math.round(Number(value) * 100) : NaN;
      const paid = money(inv.payments?.paid_amount?.value), due = money(inv.due_amount?.value);
      for (const amount of [inv.payments?.paid_amount, inv.due_amount]) {
        if (amount?.currency_code && amount.currency_code !== "EUR") problems.push("Payment or balance currency is not EUR");
      }
      if (inv.status === "PAID") {
        if (paid !== item.input.amountCents || due !== 0) problems.push("PAID status lacks matching paid amount and zero balance");
      } else if (inv.status === "PARTIALLY_PAID") {
        if (!(paid > 0 && due > 0 && paid + due === item.input.amountCents)) problems.push("Partial payment and outstanding balance do not reconcile");
      } else if (!["SENT", "UNPAID", "SCHEDULED", "PAYMENT_PENDING", "PARTIALLY_PAID"].includes(inv.status)) {
        problems.push(`Status ${inv.status} requires review; it is not verified PayPal payment`);
      }
      const invoiceEvidence = evidenceTag({ caseId: item.caseId, kind: "paypal_invoice", status: problems.length ? "mismatch" : "checked", observedAt: deps.now(),
        source: deps.execution === "simulated" ? `simulated-ledger:${item.invoiceId}` : `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${encodeURIComponent(item.invoiceId)}`,
        environment: deps.execution === "simulated" ? "simulated" : "paypal_sandbox", snapshot: inv,
        dependsOn: [latestEvidence(item.evidence, "calculation")!.id], note: problems.join("; ") || "Retrieved invoice matches the calculated bill. Payment is checked separately." });
      item.evidence.push(invoiceEvidence);
      item.evidence.push(evidenceTag({ caseId: item.caseId, kind: "payment", status: problems.length ? "mismatch" : inv.status === "PAID" ? "checked" : "pending", observedAt: invoiceEvidence.observedAt,
        source: invoiceEvidence.source, environment: invoiceEvidence.environment, dependsOn: [invoiceEvidence.id], snapshot: { invoiceId: inv.id, status: inv.status, paid: inv.payments ?? null, due: inv.due_amount ?? null },
        note: problems.join("; ") || (inv.status === "PAID" ? "Paid total and zero balance checked against this bill; not evidence of tax payment or refund." : "Payment is still pending; this case is not paid.") }));
      persistEvidence(item);
      if (problems.length) { item.state = "needs_review"; item.problems.push(...problems); }
      else item.state = inv.status === "PAID" ? "paid" : "awaiting_payment";
    }),
    finish: () => {
      if (controller.signal.aborted) return report();
      const unfinished = [...items.values()].filter((i) => ["ready", "awaiting_check"].includes(i.state));
      if (busy.size || unfinished.length) throw new Error("Cannot finish: households still need processing");
      if (!finished) { record("finish_month", "Recorded paid, awaiting-payment, no-invoice and review outcomes"); finished = true; }
      return report();
    },
    stop: (reason: string) => {
      if (controller.signal.aborted) return report();
      controller.abort();
      snapshot.problems.push(reason);
      record("agent_stopped", reason);
      return report();
    },
  };
}

export type MonthSession = ReturnType<typeof createMonthSession>;

/** Offline execution harness. Explicitly NOT an AI run; used for previews, fixtures and regression tests. */
export async function driveMonthLocally(session: MonthSession): Promise<MonthReport> {
  for (const item of session.inspect().items) {
    if (item.state === "ready") await session.issue(item.householdId);
    if (session.report().items.find((i) => i.householdId === item.householdId)?.state === "awaiting_check") await session.check(item.householdId);
  }
  return session.finish();
}
