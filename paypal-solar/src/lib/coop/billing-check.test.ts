import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkBill, loadMeterMonth, paymentState } from "./billing-check";
import type { PaymentDraft } from "./ledger";
import { sampleCoop } from "./sample-group";
import { loadState, updateState, type CoopState } from "./state";
import { submissionWorkbench } from "./submission-evidence";
import { loadWorkbench } from "./workbench";
import { seedWorkbench } from "./workbench-seed";

// Each test seeds a month on disk; under a full parallel run this can exceed the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let root: string;
let runs: string;
const period = "2026-06";
const stateDir = () => path.join(runs, "coop-rehearsal");
const item = (id: string) => loadWorkbench(runs, period, "rehearsal")!.items.find((i) => i.participantId === id)!;
const tamper = (change: (s: CoopState) => CoopState) => updateState(stateDir(), period, (s) => change(structuredClone(s!)));

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "coop-billcheck-test-"));
  runs = path.join(root, "runs");
  mkdirSync(path.join(root, "src/data"), { recursive: true });
  copyFileSync(path.join(__dirname, "../../data/coop-meter-2026-06.csv"), path.join(root, "src/data/coop-meter-2026-06.csv"));
  await seedWorkbench(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("normal bills", () => {
  it("does not flag consumption above the shared energy: the residual comes from the household's own supplier", () => {
    const h7 = item("H07");
    const c = h7.chain!;
    expect(c.billStatus).toBe("match");
    expect(c.meter!.consumptionWh).toBeGreaterThan(c.allocation!.receivedWh);
    expect(c.allocation!.receivedWh + c.allocation!.residualWh).toBe(c.meter!.consumptionWh);
    expect(c.allocation!.residualNoPoolWh + c.allocation!.residualAboveShareWh).toBe(c.allocation!.residualWh);
    expect(c.allocation!.residualNoPoolWh).toBeGreaterThan(0);
    expect(c.links.map((l) => [l.step, l.status])).toEqual([["meter", "match"], ["allocation", "match"], ["bill", "match"], ["payment", "pending"]]);
  });
  it("matches every seeded bill against the same meter file and contract terms", () => {
    const bills = loadWorkbench(runs, period, "rehearsal")!.items.filter((i) => i.kind === "bill");
    expect(bills).toHaveLength(7);
    expect(bills.every((b) => b.chain!.billStatus === "match")).toBe(true);
    expect(loadState(stateDir(), period)!.inputs).toMatchObject({ meterFile: "src/data/coop-meter-2026-06.csv", priceCt: 13 });
  });
});

describe("bills that were changed on purpose", () => {
  it("finds a changed amount and keeps the recorded value instead of the recomputation", () => {
    const before = item("H07").chain!.bill.recomputedCents!;
    tamper((s) => ({ ...s, drafts: s.drafts.map((d) => (d.participantId === "H07" && d.kind === "bill" ? { ...d, amountCents: d.amountCents + 100 } : d)) }));
    const c = item("H07").chain!;
    expect(c.billStatus).toBe("mismatch");
    expect(c.bill.recordedCents).toBe(before + 100);
    expect(c.bill.recomputedCents).toBe(before);
    expect(c.links.find((l) => l.step === "bill")!.text).toMatch(/≠ recomputed/);
    expect(loadState(stateDir(), period)!.drafts.find((d) => d.participantId === "H07" && d.kind === "bill")!.amountCents).toBe(before + 100);
    expect(item("H06").chain!.billStatus).toBe("match");
  });
  it("finds a changed billed kWh", () => {
    tamper((s) => ({ ...s, queue: s.queue.map((q) => (q.facts.participantId === "H07" && q.facts.kind === "bill" ? { ...q, facts: { ...q.facts, kWh: (Number(q.facts.kWh) + 1).toFixed(1) } } : q)) }));
    const c = item("H07").chain!;
    expect(c.billStatus).toBe("mismatch");
    expect(c.links.find((l) => l.step === "bill")!.text).toMatch(/billed .* kWh ≠ recomputed/);
  });
  it("finds a changed price", () => {
    tamper((s) => ({ ...s, queue: s.queue.map((q) => (q.facts.participantId === "H07" && q.facts.kind === "bill" ? { ...q, facts: { ...q.facts, priceCt: "14.00" } } : q)) }));
    expect(item("H07").chain!.links.find((l) => l.step === "bill")!.text).toMatch(/14.00 ct\/kWh ≠ contract 13.00/);
  });
});

describe("bills that cannot be compared", () => {
  it("does not judge a bill against a meter file that changed since billing", () => {
    const file = path.join(root, "src/data/coop-meter-2026-06.csv");
    writeFileSync(file, readFileSync(file, "utf8") + "\n");
    const c = item("H07").chain!;
    expect(c.billStatus).toBe("not_comparable");
    expect(c.links[0].text).toMatch(/changed since billing/);
  });
  it("does not judge a run that did not record its billing inputs", () => {
    tamper((s) => ({ ...s, inputs: undefined }));
    expect(item("H07").chain!.billStatus).toBe("not_comparable");
  });
  it("does not judge a run whose contract terms differ", () => {
    tamper((s) => ({ ...s, inputs: { ...s.inputs!, priceCt: 12 } }));
    expect(item("H07").chain!.links.find((l) => l.step === "bill")!.text).toMatch(/contract terms changed/);
  });
  it("still flags an internal inconsistency when the run cannot be compared", () => {
    tamper((s) => ({ ...s, inputs: undefined, drafts: s.drafts.map((d) => (d.participantId === "H07" && d.kind === "bill" ? { ...d, amountCents: d.amountCents + 1 } : d)) }));
    expect(item("H07").chain!.billStatus).toBe("mismatch");
  });
  it("shows the archived evidence as not comparable: it predates recording the inputs", () => {
    const bills = submissionWorkbench().items.filter((i) => i.kind === "bill");
    expect(bills.every((b) => b.chain!.billStatus === "not_comparable")).toBe(true);
    expect(bills.every((b) => b.chain!.bill.recomputedCents === b.chain!.bill.recordedCents)).toBe(true);
  });
  it("reports a missing meter file", () => {
    const s = loadState(stateDir(), period)!;
    const draft = s.drafts.find((d) => d.kind === "bill")!;
    const c = checkBill({ group: sampleCoop, period, draft, facts: s.queue.find((q) => q.facts.draftId === draft.id)!.facts, meter: null, recorded: s.inputs });
    expect(c.billStatus).toBe("not_comparable");
    expect(loadMeterMonth(path.join(root, "nowhere"), sampleCoop, period)).toBeNull();
  });
});

describe("payment state", () => {
  const base = (): PaymentDraft => loadState(stateDir(), period)!.drafts.find((d) => d.kind === "bill")!;
  const observed = (status: "matched" | "pending" | "mismatch", externalStatus: string) => ({
    status, checkedAt: "2026-10-15T10:00:00Z", reason: "fixture", observed: { externalStatus, amount: "12.36", reference: "ST-202606-H04" },
  });
  it("never treats a sent invoice as paid", () => {
    expect(paymentState(base()).status).toBe("not_sent");
    const sent = { ...base(), status: "executed" as const, result: { externalId: "INV2-TEST", status: "SENT" } } as PaymentDraft;
    expect(paymentState(sent).status).toBe("sent_not_checked");
    expect(paymentState(sent).label).toMatch(/Not confirmed as paid/);
    const unpaid = paymentState({ ...sent, reconciliation: observed("pending", "UNPAID") });
    expect(unpaid.status).toBe("sent_unpaid");
    expect(unpaid.observed).toMatchObject({ field: "invoice status", value: "UNPAID" });
  });
  it("counts a reconciled PAID observation as paid and names the checked field", () => {
    const paid = paymentState({ ...base(), status: "executed", reconciliation: observed("matched", "PAID") });
    expect(paid.status).toBe("paid");
    expect(paid.observed).toMatchObject({ field: "invoice status", value: "PAID", checkedAt: "2026-10-15T10:00:00Z" });
    expect(paymentState({ ...base(), status: "executed", reconciliation: observed("mismatch", "MARKED_AS_PAID") }).status).toBe("provider_mismatch");
  });
});
