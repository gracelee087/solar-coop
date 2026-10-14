import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evidenceDigest, latestEvidence } from "./case-evidence";
import { loadMonthlyPlan } from "./monthly-data";
import { rehearseMonthlyPlan, simulatedMonthDeps } from "./monthly-rehearsal";
import { createMonthSession, driveMonthLocally } from "./monthly-settlement";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External calls forbidden"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const plan = () => loadMonthlyPlan("empty_simulated_ledger");

describe("automatic evidence collection for each settlement case", () => {
  it("collects the complete energy-bill chain with inspectable snapshots, without claiming tax or refund completion", async () => {
    const result = await rehearseMonthlyPlan(plan(), "normal");
    for (const item of result.first.items) {
      expect(item.caseId).toBe(item.input!.invoiceNumber);
      for (const kind of ["agreement", "usage", "calculation", "paypal_invoice", "payment"] as const) {
        const tag = latestEvidence(item.evidence, kind)!;
        expect(tag.status).toBe("checked");
        expect(tag.caseId).toBe(item.caseId);
        expect(tag.sha256).toBe(evidenceDigest(tag.snapshot));
        expect(Number.isFinite(Date.parse(tag.observedAt))).toBe(true);
        expect(tag.dependsOn.every((id) => item.evidence.some((parent) => parent.id === id))).toBe(true);
      }
      expect(latestEvidence(item.evidence, "payment")!.environment).toBe("simulated");
      expect(latestEvidence(item.evidence, "usage")!.environment).toBe("modelled");
      for (const kind of ["supplier_bill", "tax_assessment", "customer_refund", "tax_refund"] as const) {
        expect(latestEvidence(item.evidence, kind)).toMatchObject({ status: "not_connected", snapshot: null });
      }
    }
    expect(result.first.events.some((event) => event.action === "evidence_collected" && event.evidence?.kind === "payment")).toBe(true);
  });
  it.each(["agreement", "usage", "calculation"] as const)("blocks issuing when required %s evidence is missing", async (kind) => {
    const p = plan();
    p.items[0].evidence = p.items[0].evidence.filter((tag) => tag.kind !== kind);
    const fake = simulatedMonthDeps(), settle = vi.fn(fake.deps.settle);
    const session = createMonthSession(p, { ...fake.deps, settle });
    const item = await session.issue("h1");
    expect(item.state).toBe("needs_review");
    expect(item.problems.join(" ")).toContain(`Evidence ${kind}`);
    expect(settle).not.toHaveBeenCalled();
  });
  it("rejects another household's evidence even when its snapshot hash is valid", async () => {
    const p = plan();
    p.items[0].evidence.push(structuredClone(latestEvidence(p.items[1].evidence, "agreement")!));
    const fake = simulatedMonthDeps(), settle = vi.fn(fake.deps.settle);
    expect((await createMonthSession(p, { ...fake.deps, settle }).issue("h1")).state).toBe("needs_review");
    expect(settle).not.toHaveBeenCalled();
  });
  it("blocks changed snapshots and bill inputs before external tools", async () => {
    for (const edit of ["snapshot", "metadata", "input"] as const) {
      const p = plan();
      if (edit === "snapshot") latestEvidence(p.items[0].evidence, "agreement")!.snapshot = { priceCt: 1 };
      else if (edit === "metadata") latestEvidence(p.items[0].evidence, "agreement")!.source = "invented authority";
      else p.items[0].input!.amountCents++;
      const fake = simulatedMonthDeps(), settle = vi.fn(fake.deps.settle);
      expect((await createMonthSession(p, { ...fake.deps, settle }).issue("h1")).state).toBe("needs_review");
      expect(settle).not.toHaveBeenCalled();
    }
  });
  it("retains the mismatched PayPal response as evidence and does not mark payment checked", async () => {
    const result = await rehearseMonthlyPlan(plan(), "amount_mismatch");
    const item = result.first.items[0];
    expect(latestEvidence(item.evidence, "paypal_invoice")).toMatchObject({ status: "mismatch", snapshot: { amount: { value: "999.00" } } });
    expect(latestEvidence(item.evidence, "payment")!.status).toBe("mismatch");
    expect(item.state).toBe("needs_review");
  });
  it("does not fabricate evidence when PayPal retrieval fails", async () => {
    const fake = simulatedMonthDeps();
    const session = createMonthSession(plan(), { ...fake.deps, getInvoice: async () => { throw new Error("PayPal unavailable"); } });
    await session.issue("h1");
    const item = await session.check("h1");
    expect(item.state).toBe("needs_review");
    expect(latestEvidence(item.evidence, "paypal_invoice")!.status).toBe("missing");
    expect(latestEvidence(item.evidence, "payment")!.status).toBe("missing");
  });
  it("does not finish payment verification when evidence persistence fails", async () => {
    const fake = simulatedMonthDeps();
    const session = createMonthSession(plan(), { ...fake.deps, record: (event) => {
      if (event.evidence?.kind === "paypal_invoice" && event.evidence.status === "checked") throw new Error("disk unavailable");
    } });
    await session.issue("h1");
    expect((await session.check("h1")).state).toBe("needs_review");
    expect(session.report().paidCount).toBe(0);
  });
  it("keeps pending payments distinct from checked payment evidence", async () => {
    const fake = simulatedMonthDeps();
    const session = createMonthSession(plan(), { ...fake.deps, getInvoice: async (id) => ({ ...await fake.deps.getInvoice(id), status: "SENT", payments: undefined, due_amount: undefined }) });
    await session.issue("h1");
    const item = await session.check("h1");
    expect(latestEvidence(item.evidence, "paypal_invoice")!.status).toBe("checked");
    expect(latestEvidence(item.evidence, "payment")!.status).toBe("pending");
    expect(item.state).toBe("awaiting_payment");
  });
  it("keeps missing-agreement simulation honest and historical observations intact", async () => {
    const result = await rehearseMonthlyPlan(plan(), "missing_agreement");
    const item = result.first.items[0];
    expect(item.evidence.filter((tag) => tag.kind === "agreement").length).toBeGreaterThan(1);
    expect(latestEvidence(item.evidence, "agreement")!.status).toBe("missing");
    expect(latestEvidence(item.evidence, "payment")!.status).toBe("missing");
    expect(result.createdOnFirst).toBe(2);
  });
  it("does not label old local PAID records as fresh payment evidence", async () => {
    const r = await driveMonthLocally(createMonthSession(loadMonthlyPlan(), simulatedMonthDeps().deps));
    for (const item of r.items) {
      expect(latestEvidence(item.evidence, "invoice_record")!.status).toBe("mismatch");
      expect(latestEvidence(item.evidence, "payment")!.status).toBe("missing");
    }
    expect(r.paidCount).toBe(0);
  });
});
