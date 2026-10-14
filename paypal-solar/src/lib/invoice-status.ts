import type { IssuedInvoice } from "./issued";
import type { PayPalInvoice } from "./paypal-api";

/** Live read of one issued sandbox invoice, compared with what was recorded when it was issued. */
export interface LiveInvoiceStatus {
  settlementKey: string;
  invoiceId: string;
  /** Null when the live read failed; the page then shows the recorded status, marked as recorded. */
  status: string | null;
  amountEur: string | null;
  /** Whether PayPal still has the recorded invoice number and amount; null when the read failed. */
  matchesRecord: boolean | null;
  error?: string;
}

export interface LiveStatusReport {
  /** ISO time PayPal was asked (for cached answers: when it was asked, not when the page asked). */
  checkedAt: string;
  cached: boolean;
  items: LiveInvoiceStatus[];
}

/**
 * Read-only status checker for the issued invoices. Answers are cached for `ttlMs` (failures too), and requests that
 * arrive while a check is running share that check, so reloading the page cannot flood PayPal. It never creates,
 * sends or changes an invoice.
 */
export function makeStatusChecker(deps: {
  issued: () => [string, IssuedInvoice][];
  getInvoice: (id: string) => Promise<PayPalInvoice>;
  now: () => number;
  ttlMs: number;
}) {
  let last: { at: number; report: LiveStatusReport } | null = null;
  let inFlight: Promise<LiveStatusReport> | null = null;

  const read = async (t: number): Promise<LiveStatusReport> => {
    const items = await Promise.all(
      deps.issued().map(async ([settlementKey, rec]): Promise<LiveInvoiceStatus> => {
        try {
          const inv = await deps.getInvoice(rec.invoiceId);
          const matchesRecord = inv.detail.invoice_number === rec.invoiceNumber && inv.amount.value === rec.amountEur && inv.amount.currency_code === "EUR";
          return { settlementKey, invoiceId: rec.invoiceId, status: inv.status, amountEur: inv.amount.value, matchesRecord };
        } catch (e) {
          return { settlementKey, invoiceId: rec.invoiceId, status: null, amountEur: null, matchesRecord: null, error: (e as Error).message.slice(0, 120) };
        }
      }),
    );
    const report = { checkedAt: new Date(t).toISOString(), cached: false, items };
    last = { at: t, report };
    return report;
  };

  return async (): Promise<LiveStatusReport> => {
    const t = deps.now();
    if (last && t - last.at < deps.ttlMs) return { ...last.report, cached: true };
    if (inFlight) return { ...(await inFlight), cached: true };
    inFlight = read(t).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
