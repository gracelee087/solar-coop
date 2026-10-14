import { describe, expect, it, vi } from "vitest";
import { createCorrectionCase, type Refund } from "./correction-case";
import { correctionDocument, correctionInvoices, fixtureExtraction, simulatedCorrectionPayments } from "./correction-fixtures";

const meta = { mode: "test_fixture", model: "none", elapsedMs: 0 };
function setup(options: Parameters<typeof simulatedCorrectionPayments>[0] = {}, extraction: unknown = fixtureExtraction, text = correctionDocument) {
  const p = simulatedCorrectionPayments(options);
  const c = createCorrectionCase(text, extraction, correctionInvoices, p.port, meta);
  return { c, p };
}
const prior = (status: Refund["status"], amountCents = 100): Refund => ({ id: "OLD", captureId: "SIM-CAPTURE-BEN", currency: "EUR", amountCents, status, requestId: "old" });
describe("Document correction to confirmed refund (isolated simulation)", () => {
  it("links a German correction, calculates in cents, and independently verifies refund completion", async () => {
    const { c, p } = setup();
    const r = await c.check();
    expect(r).toMatchObject({ state: "awaiting_approval", differenceCents: 200, paidCents: 1500, correctedCents: 1300 });
    expect(p.requests()).toBe(0);
    const done = await c.approve(r.approvalToken!);
    expect(done).toMatchObject({ state: "resolved", returnedCents: 200, differenceCents: 0 });
    expect(done.events.some((e) => e.step === "Refund independently retrieved")).toBe(true);
    expect(p.requests()).toBe(1);
    await c.check(); expect(p.requests()).toBe(1);
    expect((await c.approve(r.approvalToken!)).state).toBe("resolved"); expect(p.requests()).toBe(1);
  });
  it.each([
    ["unsupported amount", { ...fixtureExtraction, correctedTotal: "11,00" }],
    ["invented quote", { ...fixtureExtraction, quotes: { ...fixtureExtraction.quotes, buyer: "Käufer: Lea" } }],
    ["draft correction", { ...fixtureExtraction, final: false }],
    ["non-EUR", { ...fixtureExtraction, currency: "USD" }],
    ["invalid decimal", { ...fixtureExtraction, correctedTotal: "NaN" }],
    ["injection output", { ...fixtureExtraction, tool: "refund_all" }],
  ])("blocks %s before payment access", async (_label, extracted) => {
    const { c, p } = setup({}, extracted); const spy = vi.spyOn(p.port, "capture");
    expect((await c.check()).state).toBe("needs_review");
    await c.approve("anything"); expect(spy).not.toHaveBeenCalled(); expect(p.requests()).toBe(0);
  });
  it("blocks a well-grounded document for an unrelated supplier", async () => {
    const changed = correctionDocument.replace("Anna", "Mainova");
    const extracted = { ...fixtureExtraction, seller: "Mainova", quotes: { ...fixtureExtraction.quotes, seller: "Verkäuferin: Mainova" } };
    const { c, p } = setup({}, extracted, changed);
    expect((await c.check()).state).toBe("needs_review"); expect(p.requests()).toBe(0);
  });
  it("blocks ambiguous duplicate invoice identity", async () => {
    const p = simulatedCorrectionPayments();
    const c = createCorrectionCase(correctionDocument, fixtureExtraction, [...correctionInvoices, correctionInvoices[0]], p.port, meta);
    expect((await c.check()).state).toBe("needs_review");
  });
  it("subtracts previously completed partial refunds", async () => {
    const { c, p } = setup({ existingRefunds: [prior("COMPLETED")] });
    const r = await c.check(); expect(r.differenceCents).toBe(100);
    expect((await c.approve(r.approvalToken!)).state).toBe("resolved"); expect(p.ledger[1].amountCents).toBe(100);
  });
  it("does not repeat a pending refund", async () => {
    const { c, p } = setup({ existingRefunds: [prior("PENDING", 200)] });
    expect((await c.check()).state).toBe("refund_pending");
    await c.approve("anything"); expect(p.requests()).toBe(0);
  });
  it("does not mark a pending new refund resolved until independently read as completed", async () => {
    const { c, p } = setup({ pending: true }); const r = await c.check();
    expect((await c.approve(r.approvalToken!)).state).toBe("refund_pending");
    expect((await c.check()).state).toBe("refund_pending");
    p.complete(); expect((await c.check()).state).toBe("resolved"); expect(p.requests()).toBe(1);
  });
  it("serializes concurrent approval so there is only one request", async () => {
    const { c, p } = setup(); const r = await c.check();
    await Promise.all([c.approve(r.approvalToken!), c.approve(r.approvalToken!)]);
    expect(p.requests()).toBe(1); expect(c.report().state).toBe("resolved");
  });
  it("rejects a changed ledger after seller saw the approval", async () => {
    const { c, p } = setup(); const r = await c.check(); p.ledger.push(prior("COMPLETED"));
    expect((await c.approve(r.approvalToken!)).state).toBe("needs_review"); expect(p.requests()).toBe(0);
  });
  it("keeps a lost POST response unknown without issuing a second refund", async () => {
    const { c, p } = setup({ failRequest: true }); const r = await c.check();
    expect((await c.approve(r.approvalToken!)).state).toBe("refund_unknown");
    expect((await c.check()).state).toBe("refund_unknown");
    await c.approve(r.approvalToken!); expect(p.requests()).toBe(1);
  });
  it("does not close if the independent refund response is altered", async () => {
    const { c, p } = setup(); const r = await c.check();
    p.port.refund = async () => ({ ...p.ledger[0], amountCents: 201 });
    expect((await c.approve(r.approvalToken!)).state).toBe("needs_review");
  });
  it.each(["buyer", "currency", "invoiceNumber", "id", "status"] as const)("rejects a payment with mismatched %s", async (field) => {
    const { c, p } = setup(); p.captures[0][field] = "WRONG";
    expect((await c.check()).state).toBe("needs_review"); expect(p.requests()).toBe(0);
  });
  it("rejects duplicate refund records", async () => {
    const { c } = setup({ existingRefunds: [prior("COMPLETED"), prior("COMPLETED")] });
    expect((await c.check()).state).toBe("needs_review");
  });
  it("routes an underpayment to review instead of creating a refund", async () => {
    const { c, p } = setup({ paidCents: 1200 }); expect((await c.check()).state).toBe("needs_review"); expect(p.requests()).toBe(0);
  });
  it("does not leak mutable internal state through reports", async () => {
    const { c } = setup(); const r = await c.check(); r.invoice!.buyer = "Mallory"; r.correctedCents = 0;
    expect(c.report().invoice!.buyer).toBe("Ben"); expect(c.report().correctedCents).toBe(1300);
  });
});
