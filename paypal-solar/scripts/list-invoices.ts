// Lists the most recent sandbox invoices of the producer's app (newest first).
import "./env";
import { getToken, type PayPalInvoice } from "../src/lib/paypal-api";

(async () => {
  const res = await fetch("https://api-m.sandbox.paypal.com/v2/invoicing/invoices?page=1&page_size=10&total_required=true", {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  const data = (await res.json()) as { total_items?: number; items?: PayPalInvoice[] };
  console.log(`total invoices: ${data.total_items}`);
  for (const i of data.items ?? []) {
    console.log(i.id, i.status, i.detail.invoice_number, i.amount.value, i.primary_recipients?.[0]?.billing_info?.email_address);
  }
})();
