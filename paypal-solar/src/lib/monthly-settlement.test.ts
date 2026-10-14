import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findAgreement } from "./agreement";
import { demoGroup, sandboxEmails } from "./demo-group";
import { loadMonthlyPlan } from "./monthly-data";
import { createMonthSession, driveMonthLocally, prepareMonth } from "./monthly-settlement";
import { rehearseMonthlyPlan, simulatedMonthDeps } from "./monthly-rehearsal";
import { loadRealJuneFrom } from "./real-data-files";
import { defaultSettings } from "./tariffs";
import type { IssuedInvoice } from "./issued";

const args = () => ({
  period: "2026-06", group: demoGroup, emails: sandboxEmails, settings: defaultSettings,
  intervals: loadRealJuneFrom(path.join(process.cwd(), "src", "data"), demoGroup),
  findAgreement, findIssued: (): IssuedInvoice | null => null,
});
const plan = () => loadMonthlyPlan("empty_simulated_ledger");
function setup() {
  const fake = simulatedMonthDeps();
  const settle = vi.fn(fake.deps.settle), getInvoice = vi.fn(fake.deps.getInvoice);
  const deps = { ...fake.deps, settle, getInvoice };
  return { ...fake, deps, settle, getInvoice, session: createMonthSession(plan(), deps) };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External calls forbidden"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("monthly preflight", () => {
  it("uses saved prices and computes the same June bills, without renegotiation", () => {
    const p = plan();
    expect(p.problems).toEqual([]);
    expect(p.items.map((i) => i.input?.priceCt)).toEqual([12.4, 12.95, 13.31]);
    expect(p.items.map((i) => i.input?.amountCents)).toEqual([1192, 1700, 1539]);
    expect(p.items.map((i) => i.state)).toEqual(["ready", "ready", "ready"]);
  });
  it("flags all historical invoices as conflicts instead of paying or billing them again", async () => {
    const p = loadMonthlyPlan();
    expect(p.items.map((i) => i.state)).toEqual(["needs_review", "needs_review", "needs_review"]);
    const t = setup();
    const result = await driveMonthLocally(createMonthSession(p, t.deps));
    expect(result.reviewRequired).toBe(3);
    expect(result.paidCount).toBe(0);
    expect(t.settle).not.toHaveBeenCalled();
    expect(t.getInvoice).not.toHaveBeenCalled();
  });
  it("blocks the entire month for a gap before any payment tool", async () => {
    const a = args(); a.intervals.pop();
    const p = prepareMonth(a), t = setup();
    const r = await driveMonthLocally(createMonthSession(p, t.deps));
    expect(r.problems[0]).toContain("2,880");
    expect(r.items).toEqual([]);
    expect(t.settle).not.toHaveBeenCalled();
    expect(t.getInvoice).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -1])("blocks invalid meter values %s before payment tools", (value) => {
    const a = args(); a.intervals[0].generationWh = value;
    expect(prepareMonth(a).problems.length).toBe(1);
  });
  it("rejects a wrong month and a swapped agreement key", () => {
    expect(prepareMonth({ ...args(), period: "2026-07" }).items).toEqual([]);
    const p = prepareMonth({ ...args(), findAgreement: () => findAgreement("ES-202606-P1-H2") });
    expect(p.items[0].problems).toContain("Agreement stored under the wrong household key");
  });
  it("rejects a nonfinite price window", () => {
    const p = prepareMonth({ ...args(), findAgreement: (key) => {
      const a = structuredClone(findAgreement(key)!); a.basis.window.ceilingCt = NaN; return a;
    } });
    expect(p.items.every((i) => i.state === "needs_review")).toBe(true);
  });
  it("zero usage with valid terms requires no PayPal calls", async () => {
    const a = args(); a.intervals.forEach((i) => { i.generationWh = 0; i.selfUseWh = 0; });
    const t = setup(), r = await driveMonthLocally(createMonthSession(prepareMonth(a), t.deps));
    expect(r.items.map((i) => i.state)).toEqual(["no_invoice", "no_invoice", "no_invoice"]);
    expect(t.settle).not.toHaveBeenCalled(); expect(t.getInvoice).not.toHaveBeenCalled();
  });
  it("zero usage does not hide invalid agreement terms", () => {
    const a = args(); a.intervals.forEach((i) => { i.generationWh = 0; i.selfUseWh = 0; });
    const p = prepareMonth({ ...a, findAgreement: () => null });
    expect(p.items.every((i) => i.state === "needs_review")).toBe(true);
  });
});

describe("monthly guarded workflow", () => {
  it("does not enter a queued billing call after cancellation in the same tick", async () => {
    const t = setup();
    const pending = t.session.issue("h1");
    t.session.stop("operator cancelled");
    await pending;
    expect(t.settle).not.toHaveBeenCalled();
  });
  it("serializes different tools for the same household instead of skipping the payment check", async () => {
    const t = setup();
    await Promise.all([t.session.issue("h1"), t.session.check("h1")]);
    expect(t.settle).toHaveBeenCalledTimes(1);
    expect(t.getInvoice).toHaveBeenCalledTimes(1);
    expect(t.session.report().items[0].state).toBe("paid");
  });
  it("does not accept a late payment response after cancellation", async () => {
    const t = setup();
    await t.session.issue("h1");
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    t.getInvoice.mockImplementation(async (id) => { await waiting; return simulatedRead(t.invoices, id); });
    const pending = t.session.check("h1");
    await Promise.resolve();
    t.session.stop("operator cancelled");
    release(); await pending;
    expect(t.session.report().paidCount).toBe(0);
    expect(t.session.report().items[0].state).toBe("needs_review");
  });
  it("finishes a simulated paid month and creates no additional invoices on replay", async () => {
    const result = await rehearseMonthlyPlan(plan(), "normal");
    expect(result.first).toMatchObject({ finished: true, paidCount: 3, reviewRequired: 0, execution: "simulated" });
    expect(result.createdOnFirst).toBe(3); expect(result.createdOnReplay).toBe(0);
    expect(result.replay.paidCount).toBe(3);
  });
  it.each(["missing_agreement", "amount_mismatch"] as const)("routes %s to review", async (scenario) => {
    const result = await rehearseMonthlyPlan(plan(), scenario);
    expect(result.first.reviewRequired).toBe(1);
    expect(result.first.paidCount).toBe(2);
    expect(result.createdOnFirst).toBe(scenario === "missing_agreement" ? 2 : 3);
    expect(result.createdOnReplay).toBe(0);
  });
  it("deduplicates simultaneous tool calls and resists returned-plan mutation", async () => {
    const t = setup();
    const exposed = t.session.inspect(); exposed.items[0].input!.amountCents = 99999;
    await Promise.all([t.session.issue("h1"), t.session.issue("h1")]);
    expect(t.settle).toHaveBeenCalledTimes(1);
    expect(t.settle.mock.calls[0][0].amountCents).toBe(1192);
    await t.session.issue("h1"); expect(t.settle).toHaveBeenCalledTimes(1);
    await expect(t.session.issue("constructor")).rejects.toThrow("Unknown household");
  });
  it("does not declare completion before issuing and reconciling", async () => {
    const t = setup();
    expect(() => t.session.finish()).toThrow("still need processing");
    await t.session.check("h1"); expect(t.getInvoice).not.toHaveBeenCalled();
    await t.session.issue("h1"); expect(() => t.session.finish()).toThrow();
  });
  it.each(["SENT", "UNPAID", "PAYMENT_PENDING", "PARTIALLY_PAID"])("keeps %s pending, with no debit or repeated polling", async (status) => {
    const t = setup();
    t.getInvoice.mockImplementation(async (id) => {
      const invoice = structuredClone(await simulatedRead(t.invoices, id));
      if (status === "PARTIALLY_PAID") {
        invoice.payments = { paid_amount: { value: "1.00" } };
        invoice.due_amount = { value: (Number(invoice.amount.value) - 1).toFixed(2) };
      }
      return { ...invoice, status };
    });
    const result = await driveMonthLocally(t.session);
    expect(result.paidCount).toBe(0); expect(result.pendingCount).toBe(3);
    await t.session.check("h1"); expect(t.getInvoice).toHaveBeenCalledTimes(3);
  });
  it.each(["MARKED_AS_PAID", "REFUNDED", "CANCELLED", "DRAFT", "UNKNOWN"])("does not claim PayPal payment for %s", async (status) => {
    const t = setup(); t.getInvoice.mockImplementation(async (id) => ({ ...await simulatedRead(t.invoices, id), status }));
    const r = await driveMonthLocally(t.session);
    expect(r.paidCount).toBe(0); expect(r.reviewRequired).toBe(3);
  });
  it.each(["amount", "recipient", "number", "id", "paid", "due", "paid_currency", "partial_balance"])("blocks a mismatched %s on read-back", async (field) => {
    const t = setup(); t.getInvoice.mockImplementation(async (id) => {
      const i = structuredClone(await simulatedRead(t.invoices, id));
      if (field === "amount") i.amount.value = "0.01";
      if (field === "recipient") i.primary_recipients = [];
      if (field === "number") i.detail.invoice_number = "other";
      if (field === "id") i.id = "other";
      if (field === "paid") i.payments = undefined;
      if (field === "due") i.due_amount = { value: "0.01" };
      if (field === "paid_currency") i.payments!.paid_amount!.currency_code = "USD";
      if (field === "partial_balance") { i.status = "PARTIALLY_PAID"; i.due_amount = { value: "1.00" }; }
      return i;
    });
    const r = await driveMonthLocally(t.session);
    expect(r.paidCount).toBe(0); expect(r.reviewRequired).toBe(3);
  });
  it("does not retry an uncertain creation failure", async () => {
    const t = setup(); t.settle.mockRejectedValue(new Error("Timeout after possible creation"));
    await t.session.issue("h1"); await t.session.issue("h1");
    expect(t.settle).toHaveBeenCalledTimes(1);
    expect(t.session.report().items[0].state).toBe("needs_review");
  });
  it("blocks issuing if audit persistence fails or issuing is disabled", async () => {
    const t = setup();
    const broken = createMonthSession(plan(), { ...t.deps, record: () => { throw new Error("disk full"); } });
    await expect(broken.issue("h1")).rejects.toThrow("disk full");
    const disabled = createMonthSession(plan(), { ...t.deps, allowIssue: false });
    await disabled.issue("h1");
    expect(t.settle).not.toHaveBeenCalled();
  });
  it("passes cancellation into the billing tool and prevents subsequent writes", async () => {
    const t = setup();
    await t.session.issue("h1"); const signal = t.settle.mock.calls[0][1];
    t.session.stop("cancelled");
    expect(signal.aborted).toBe(true);
    await t.session.issue("h2"); expect(t.settle).toHaveBeenCalledTimes(1);
  });
  it("checks an existing matching record without issuing again", async () => {
    const t = setup(); await driveMonthLocally(t.session);
    const p = prepareMonth({ ...args(), findIssued: (key) => {
      const i = plan().items.find((x) => x.input?.invoiceNumber === key)!.input!;
      const inv = t.invoices.get(key)!;
      return { invoiceId: inv.id, invoiceNumber: key, neighbour: i.consumer.name, sharedKWh: i.sharedKWh, priceCt: i.priceCt, amountEur: inv.amount.value, issued: "2026-07-01", statusAtRecord: "SENT" };
    } });
    t.settle.mockClear();
    const r = await driveMonthLocally(createMonthSession(p, t.deps));
    expect(r.paidCount).toBe(3); expect(t.settle).not.toHaveBeenCalled();
  });
});

async function simulatedRead(invoices: ReturnType<typeof simulatedMonthDeps>["invoices"], id: string) {
  return [...invoices.values()].find((i) => i.id === id)!;
}
