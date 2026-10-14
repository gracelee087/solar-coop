import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const id = z.string().min(1).max(100);
const cents = z.number().int().min(0).max(100_000_000);
export const correctionSchema = z.object({
  invoiceNumber: id, seller: id, buyer: id, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  currency: z.literal("EUR"), correctedTotal: z.string().regex(/^\d{1,6}[.,]\d{2}$/),
  final: z.boolean(),
  quotes: z.object({ invoiceNumber: id, seller: id, buyer: id, period: id, currency: id, correctedTotal: id, final: id }).strict(),
}).strict();
export type Correction = z.infer<typeof correctionSchema>;
export interface CaseInvoice { invoiceNumber: string; seller: string; buyer: string; period: string; currency: "EUR"; amountCents: number; captureId: string }
export interface Capture { id: string; invoiceNumber: string; seller: string; buyer: string; currency: string; paidCents: number; status: string }
export interface Refund { id: string; captureId: string; currency: string; amountCents: number; status: "PENDING" | "COMPLETED" | "FAILED"; requestId: string }
export interface PaymentPort {
  environment: "simulated";
  capture(id: string): Promise<Capture>;
  refunds(captureId: string): Promise<Refund[]>;
  requestRefund(captureId: string, amountCents: number, requestId: string): Promise<Refund>;
  refund(id: string): Promise<Refund>;
}
export type CaseState = "needs_review" | "awaiting_approval" | "refund_pending" | "refund_unknown" | "resolved";
export interface CaseEvent { step: string; at: string; evidenceId: string; snapshot: unknown }
export interface CaseReport {
  caseId: string; environment: "simulated"; state: CaseState; invoice: CaseInvoice | null;
  documentSha256: string; correction: Correction | null; extraction: { mode: string; model: string; elapsedMs: number };
  correctedCents: number | null; paidCents: number | null; returnedCents: number; differenceCents: number | null;
  approvalToken: string | null; refundId: string | null; problems: string[]; events: CaseEvent[]; explanation: string;
}

/** A quote proves grounding in the uploaded text, not authenticity or permission to move money. */
export function validateCorrection(text: string, proposed: unknown, invoices: CaseInvoice[]) {
  if (!text.trim() || text.length > 16_000) throw new Error("Document must contain 1–16,000 characters");
  const c = correctionSchema.parse(proposed);
  for (const [key, quote] of Object.entries(c.quotes)) {
    if (!text.includes(quote)) throw new Error(`Unsupported source quote: ${key}`);
    if (key !== "final" && !quote.includes(c[key as Exclude<keyof typeof c.quotes, "final">])) throw new Error(`Value absent from quote: ${key}`);
  }
  if (!c.final) throw new Error("Correction is not final");
  const matches = invoices.filter((i) => i.invoiceNumber === c.invoiceNumber && i.seller === c.seller && i.buyer === c.buyer && i.period === c.period && i.currency === c.currency);
  if (matches.length !== 1) throw new Error("Invoice, parties, period and currency must identify exactly one transaction");
  const invoice = matches[0];
  cents.parse(invoice.amountCents);
  const [euros, fraction] = c.correctedTotal.replace(",", ".").split(".");
  const correctedCents = cents.parse(Number(euros) * 100 + Number(fraction));
  return { correction: c, invoice: structuredClone(invoice), correctedCents };
}

/** Isolated demonstration session. No live payment adapter is accepted or exposed by this workflow. */
export function createCorrectionCase(text: string, proposed: unknown, invoices: CaseInvoice[], port: PaymentPort,
  extraction: CaseReport["extraction"]) {
  const report: CaseReport = { caseId: randomUUID(), environment: "simulated", state: "needs_review", invoice: null,
    documentSha256: hash(text), correction: null, extraction, correctedCents: null, paidCents: null, returnedCents: 0,
    differenceCents: null, approvalToken: null, refundId: null, problems: [], events: [], explanation: "Evidence requires review." };
  let attempted = false;
  let busy: Promise<CaseReport> | null = null;
  let valid = false;
  let requestId = "";
  let requestedCents: number | null = null;
  const event = (step: string, snapshot: unknown) => {
    const at = new Date().toISOString();
    report.events.push({ step, at, snapshot: structuredClone(snapshot), evidenceId: hash({ caseId: report.caseId, step, at, snapshot }) });
  };
  const fail = (message: string) => { report.state = "needs_review"; report.approvalToken = null; report.problems = [message]; report.explanation = message; };
  try {
    if (port.environment !== "simulated") throw new Error("This demo accepts simulated payments only");
    const result = validateCorrection(text, proposed, invoices);
    report.invoice = result.invoice; report.correction = result.correction; report.correctedCents = result.correctedCents;
    requestId = hash({ invoice: result.invoice, document: report.documentSha256 }).slice(0, 36);
    valid = true;
    event("Document linked to invoice", { sha256: report.documentSha256, extraction, correction: result.correction });
  } catch (e) { fail((e as Error).message); }
  const snapshot = () => structuredClone(report);
  async function inspect() {
    if (!valid) return;
    const invoice = report.invoice!;
    const payment = await port.capture(invoice.captureId);
    event("Payment independently retrieved", payment);
    if (payment.id !== invoice.captureId || payment.invoiceNumber !== invoice.invoiceNumber || payment.seller !== invoice.seller || payment.buyer !== invoice.buyer || payment.currency !== invoice.currency || payment.status !== "COMPLETED") throw new Error("Payment identity, currency or final status does not match");
    cents.parse(payment.paidCents);
    const refunds = await port.refunds(invoice.captureId);
    event("Refund ledger independently retrieved", refunds);
    const seen = new Set<string>();
    for (const r of refunds) {
      if (!r.id || seen.has(r.id) || r.captureId !== invoice.captureId || r.currency !== invoice.currency || !["PENDING", "COMPLETED", "FAILED"].includes(r.status)) throw new Error("Refund ledger has duplicate or mismatched records");
      seen.add(r.id); cents.parse(r.amountCents);
    }
    report.paidCents = payment.paidCents;
    report.returnedCents = refunds.filter((r) => r.status === "COMPLETED").reduce((sum, r) => sum + r.amountCents, 0);
    report.differenceCents = payment.paidCents - report.returnedCents - report.correctedCents!;
    if (report.returnedCents > payment.paidCents) throw new Error("Returned amount exceeds payment");
    // A POST response or a model statement never establishes completion. Read the refund separately.
    if (report.refundId) {
      const result = await port.refund(report.refundId);
      event("Refund independently retrieved", result);
      const ledger = refunds.find((r) => r.id === result.id);
      if (result.id !== report.refundId || result.captureId !== invoice.captureId || result.currency !== invoice.currency || result.amountCents !== requestedCents || result.requestId !== requestId || !ledger || hash(ledger) !== hash(result)) throw new Error("Refund confirmation differs from requested transaction or ledger");
      if (result.status === "FAILED") throw new Error("Refund failed; review before any new attempt");
    }
    report.problems = [];
    if (refunds.some((r) => r.status === "PENDING")) { report.state = "refund_pending"; report.explanation = "Refund pending. Money movement is not yet confirmed."; return; }
    if (attempted && !report.refundId) { report.state = "refund_unknown"; report.explanation = "Request outcome unknown. Review the provider record; do not submit again."; return; }
    if (report.differenceCents === 0) {
      report.state = "resolved"; report.approvalToken = null;
      report.explanation = `Paid €${(payment.paidCents / 100).toFixed(2)} − confirmed refunds €${(report.returnedCents / 100).toFixed(2)} = corrected bill €${(report.correctedCents! / 100).toFixed(2)}. Difference €0.00. Simulated settlement reconciled.`;
    } else if (report.differenceCents < 0 || attempted) throw new Error("Remaining difference needs review");
    else {
      report.state = "awaiting_approval";
      report.approvalToken = hash({ caseId: report.caseId, document: report.documentSha256, payment, refunds, correctedCents: report.correctedCents });
      report.explanation = `Seller approval needed for a €${(report.differenceCents / 100).toFixed(2)} simulated refund. Verify the source correction is authentic.`;
    }
  }
  function exclusive(fn: () => Promise<void>) {
    if (busy) return busy;
    busy = (async () => { try { await fn(); } catch (e) { fail((e as Error).message); } return snapshot(); })().finally(() => { busy = null; });
    return busy;
  }
  return {
    report: snapshot,
    check: () => exclusive(inspect),
    approve: (token: string) => exclusive(async () => {
      if (attempted) { await inspect(); return; } // Replay reads the provider; it never sends another request.
      if (!valid || attempted || report.state !== "awaiting_approval" || !token || token !== report.approvalToken) throw new Error("No current approval for this correction");
      await inspect(); // Reject stale approval if another payment/refund arrived.
      if (report.state !== "awaiting_approval" || token !== report.approvalToken) throw new Error("Payment changed since approval was prepared");
      attempted = true; requestedCents = report.differenceCents!; report.approvalToken = null;
      event("Seller approved simulated refund", { requestId, amountCents: requestedCents, documentSha256: report.documentSha256 });
      try {
        const response = await port.requestRefund(report.invoice!.captureId, requestedCents, requestId);
        if (!response.id || response.captureId !== report.invoice!.captureId || response.amountCents !== requestedCents || response.currency !== "EUR" || response.requestId !== requestId) throw new Error("Unexpected refund response");
        report.refundId = response.id;
        event("Refund requested, not yet confirmed", response);
      } catch { report.state = "refund_unknown"; report.explanation = "Refund request outcome unknown. No automatic retry."; return; }
      await inspect();
    }),
  };
}
