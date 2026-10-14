import record from "../data/issued-invoices.json";

export interface IssuedInvoice {
  invoiceId: string;
  invoiceNumber: string;
  neighbour: string;
  sharedKWh: number;
  priceCt: number;
  amountEur: string;
  issued: string;
  statusAtRecord: string;
}

const settlements: Record<string, IssuedInvoice> = record.settlements;

/** The invoice already issued for this settlement key (e.g. "ES-202606-P1-H1"), if any. */
export function findIssued(settlementKey: string): IssuedInvoice | null {
  return settlements[settlementKey] ?? null;
}

export function allIssued(): [string, IssuedInvoice][] {
  return Object.entries(settlements);
}
