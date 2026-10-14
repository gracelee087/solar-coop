import { allIssued } from "@/lib/issued";
import { makeStatusChecker } from "@/lib/invoice-status";
import { getInvoice } from "@/lib/paypal-api";

// Read-only: GET invoice status from the PayPal sandbox for the invoices already issued. Cached for 60 s.
export const dynamic = "force-dynamic";

const check = makeStatusChecker({ issued: allIssued, getInvoice, now: Date.now, ttlMs: 60_000 });

export async function GET() {
  return Response.json(await check());
}
