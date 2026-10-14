// Cancels a sent sandbox invoice, e.g. one created by mistake. Usage: tsx scripts/cancel-invoice.ts <INVOICE_ID>
import "./env";
import { getInvoice, getToken } from "../src/lib/paypal-api";

(async () => {
  const id = process.argv[2];
  const res = await fetch(`https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ subject: "Invoice cancelled", note: "Sent twice by mistake. Please ignore it.", send_to_recipient: true }),
  });
  console.log(`cancel ${id}: HTTP ${res.status}`);
  console.log(`status now: ${(await getInvoice(id)).status}`);
})();
