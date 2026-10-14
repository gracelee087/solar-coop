import type { Capture, CaseInvoice, Correction, PaymentPort, Refund } from "./correction-case";

export const correctionInvoices: CaseInvoice[] = [
  { invoiceNumber: "SOL-2026-06-ANNA-BEN", seller: "Anna", buyer: "Ben", period: "2026-06", currency: "EUR", amountCents: 1500, captureId: "SIM-CAPTURE-BEN" },
  { invoiceNumber: "SOL-2026-06-ANNA-LEA", seller: "Anna", buyer: "Lea", period: "2026-06", currency: "EUR", amountCents: 1500, captureId: "SIM-CAPTURE-LEA" },
  { invoiceNumber: "SOL-2026-07-ANNA-BEN", seller: "Anna", buyer: "Ben", period: "2026-07", currency: "EUR", amountCents: 1700, captureId: "SIM-CAPTURE-JULY" },
];
export const correctionDocument = `RECHNUNGSBERICHTIGUNG — FIKTIVES DEMO-DOKUMENT
Verkäuferin: Anna
Käufer: Ben
Rechnungsnummer: SOL-2026-06-ANNA-BEN
Leistungsmonat: 2026-06
Die Abrechnung wurde nach einer Korrektur der zugeteilten Strommenge angepasst.
Bisheriger Rechnungsbetrag: 15,00 EUR.
Der endgültige korrigierte Gesamtbetrag beträgt 13,00 EUR.
Diese Berichtigung ist endgültig und ersetzt den bisherigen Rechnungsbetrag.
Bitte ordnen Sie diese Berichtigung nur der oben genannten Rechnung zu.
`;
/** Deterministic fixture for regression tests, never passed off as a model response. */
export const fixtureExtraction: Correction = {
  invoiceNumber: "SOL-2026-06-ANNA-BEN", seller: "Anna", buyer: "Ben", period: "2026-06", currency: "EUR", correctedTotal: "13,00", final: true,
  quotes: { invoiceNumber: "Rechnungsnummer: SOL-2026-06-ANNA-BEN", seller: "Verkäuferin: Anna", buyer: "Käufer: Ben", period: "Leistungsmonat: 2026-06", currency: "13,00 EUR", correctedTotal: "Der endgültige korrigierte Gesamtbetrag beträgt 13,00 EUR.", final: "Diese Berichtigung ist endgültig und ersetzt den bisherigen Rechnungsbetrag." },
};
export function simulatedCorrectionPayments(options: { pending?: boolean; paidCents?: number; existingRefunds?: Refund[]; failRequest?: boolean } = {}) {
  const ledger = structuredClone(options.existingRefunds ?? []);
  let requests = 0;
  const captures = correctionInvoices.map((i): Capture => ({ id: i.captureId, invoiceNumber: i.invoiceNumber, seller: i.seller, buyer: i.buyer, currency: i.currency, paidCents: options.paidCents ?? i.amountCents, status: "COMPLETED" }));
  const port: PaymentPort = {
    environment: "simulated",
    capture: async (id) => { const c = captures.find((c) => c.id === id); if (!c) throw new Error("Unknown capture"); return structuredClone(c); },
    refunds: async (id) => structuredClone(ledger.filter((r) => r.captureId === id)),
    requestRefund: async (captureId, amountCents, requestId) => {
      const old = ledger.find((r) => r.requestId === requestId);
      if (old) return structuredClone(old);
      requests++;
      const record: Refund = { id: `SIM-REFUND-${requests}`, captureId, currency: "EUR", amountCents, requestId, status: options.pending ? "PENDING" : "COMPLETED" };
      ledger.push(record);
      if (options.failRequest) throw new Error("Connection lost after provider accepted request");
      return structuredClone(record);
    },
    refund: async (id) => { const r = ledger.find((r) => r.id === id); if (!r) throw new Error("Unknown refund"); return structuredClone(r); },
  };
  return { port, requests: () => requests, complete: () => ledger.forEach((r) => { if (r.status === "PENDING") r.status = "COMPLETED"; }), ledger, captures };
}
