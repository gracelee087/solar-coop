// Sandbox test of re-run safety: sequential re-run, interrupted run, conflicting draft, concurrent runs.
// Uses a fake producer id per run (fresh invoice numbers and request ids) and cancels/deletes everything at the end.
import "./env";
import { buildCreateInvoiceArgs, settlementKey, type InvoiceInput } from "../src/lib/invoice";
import { findInvoiceByNumber, getToken } from "../src/lib/paypal-api";
import { paypalTools } from "../src/lib/paypal-tools";
import { settleWithAgent } from "../src/lib/settlement-agent";

const BASE = "https://api-m.sandbox.paypal.com/v2/invoicing/invoices";
const run = `T${Date.now().toString(36).toUpperCase()}`;
const buyers: Record<string, string> = {
  h1: "sb-pghul53340264@personal.example.com",
  h2: "sb-mocy053340320@personal.example.com",
  h3: "sb-jeitd53340338@personal.example.com",
};
const input = (h: string, period = "2099-12", amountCents = 1000): InvoiceInput => ({
  producer: { name: "Haus 12", email: "sb-c6nah53337070@business.example.com" },
  consumer: { name: `Test ${h}`, email: buyers[h] },
  period, sharedKWh: 80, priceCt: 12.5, amountCents,
  invoiceNumber: settlementKey(period, run, h), invoiceDate: new Date().toISOString().slice(0, 10), // a future date makes PayPal schedule instead of send
});

/** Simulates a run that stopped right after create_invoice: a draft exists, nothing was sent. */
async function createDraft(i: InvoiceInput) {
  const create = paypalTools({ invoices: { create: true } }, `draft-${i.invoiceNumber}`).create_invoice as unknown as {
    execute: (a: unknown, o: unknown) => Promise<unknown>;
  };
  await create.execute(buildCreateInvoiceArgs(i), { toolCallId: "test", messages: [] });
}

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

(async () => {
  // 1. Sequential re-run: the second run returns the first invoice.
  const a1 = await settleWithAgent(input("h1"));
  const a2 = await settleWithAgent(input("h1"));
  check("re-run", a1.outcome === "created" && a2.outcome === "existing" && a2.invoiceId === a1.invoiceId && a2.toolCalls.length === 0,
    `${a1.outcome} ${a1.invoiceId} ${a1.invoice?.status} → ${a2.outcome} ${a2.invoiceId}`);

  // 2. Interrupted run: a matching draft is sent, not duplicated.
  await createDraft(input("h2"));
  const b = await settleWithAgent(input("h2"));
  check("interrupted run", b.outcome === "resumed" && b.invoice?.status === "SENT" && b.toolCalls.length === 0,
    `${b.outcome} ${b.invoiceId} ${b.invoice?.status}`);

  // 3. Conflicting draft (different amount): nothing is sent.
  await createDraft(input("h3", "2099-12", 1100));
  const c = await settleWithAgent(input("h3"));
  const cNow = await findInvoiceByNumber(input("h3").invoiceNumber);
  check("conflicting draft", c.outcome === "conflict" && cNow?.status === "DRAFT",
    `${c.outcome} (${c.problems.join("; ")}), status still ${cNow?.status}`);

  // 4. Concurrent runs for the same settlement: one invoice in PayPal.
  const [d1, d2] = await Promise.all([settleWithAgent(input("h1", "2099-11")), settleWithAgent(input("h1", "2099-11"))]);
  const dNow = await findInvoiceByNumber(input("h1", "2099-11").invoiceNumber);
  const okOutcomes = ["created", "existing", "resumed"];
  check("concurrent runs", okOutcomes.includes(d1.outcome) && okOutcomes.includes(d2.outcome) && d1.invoiceId !== null && d1.invoiceId === d2.invoiceId && dNow?.id === d1.invoiceId && dNow?.status === "SENT",
    `${d1.outcome} ${d1.invoiceId} / ${d2.outcome} ${d2.invoiceId}; PayPal holds ${dNow?.id} ${dNow?.status}`);

  // Cleanup: cancel sent test invoices, delete drafts.
  const auth = { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" };
  for (const n of [input("h1").invoiceNumber, input("h2").invoiceNumber, input("h3").invoiceNumber, input("h1", "2099-11").invoiceNumber]) {
    const inv = await findInvoiceByNumber(n);
    if (!inv) continue;
    const r = inv.status === "DRAFT"
      ? await fetch(`${BASE}/${inv.id}`, { method: "DELETE", headers: auth })
      : await fetch(`${BASE}/${inv.id}/cancel`, { method: "POST", headers: auth, body: JSON.stringify({ subject: "Test invoice", note: "Automated re-run test. Please ignore.", send_to_recipient: false }) });
    console.log(`cleanup ${n} ${inv.id} (${inv.status}): HTTP ${r.status}`);
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
})();
