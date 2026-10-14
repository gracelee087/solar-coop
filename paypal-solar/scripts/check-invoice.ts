// Prints the current PayPal status of one or more sandbox invoices, e.g. after a neighbour has paid.
import "./env";
import { getInvoice } from "../src/lib/paypal-api";

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error("usage: tsx scripts/check-invoice.ts INV2-XXXX-...");
  for (const id of ids) {
    const inv = await getInvoice(id);
    console.log(`${id}: status ${inv.status}, amount ${inv.amount.value} ${inv.amount.currency_code}, ` +
      `paid ${inv.payments?.paid_amount?.value ?? "0.00"}, due ${inv.due_amount?.value ?? "-"}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
