import { loadMonthlyPlan } from "./monthly-data";
import { createMonthSession, driveMonthLocally, type MonthDeps, type MonthPlan } from "./monthly-settlement";
import type { PayPalInvoice } from "./paypal-api";
import { evidenceTag } from "./case-evidence";

export type RehearsalScenario = "normal" | "missing_agreement" | "amount_mismatch";

/** Isolated fake PayPal ledger. No SDK, network, agreement writes or real invoice writes. */
export function simulatedMonthDeps(scenario: RehearsalScenario = "normal") {
  const invoices = new Map<string, PayPalInvoice>();
  let created = 0;
  const deps: MonthDeps = {
    execution: "simulated", allowIssue: true, now: () => new Date().toISOString(), record: () => {},
    settle: async (input) => {
      const previous = invoices.get(input.invoiceNumber);
      const invoice: PayPalInvoice = previous ?? {
        id: `SIMULATED-${++created}`, status: "PAID",
        detail: { invoice_number: input.invoiceNumber, currency_code: "EUR" },
        primary_recipients: [{ billing_info: { email_address: input.consumer.email } }],
        amount: { value: (input.amountCents / 100).toFixed(2), currency_code: "EUR" },
        payments: { paid_amount: { value: (input.amountCents / 100).toFixed(2) } }, due_amount: { value: "0.00" },
      };
      invoices.set(input.invoiceNumber, invoice);
      return { outcome: previous ? "existing" : "created", invoiceId: invoice.id, invoice, problems: [], toolCalls: [], model: null };
    },
    getInvoice: async (id) => {
      const inv = [...invoices.values()].find((x) => x.id === id);
      if (!inv) throw new Error("No simulated invoice");
      const copy = structuredClone(inv);
      if (scenario === "amount_mismatch" && id === "SIMULATED-1") copy.amount.value = "999.00";
      return copy;
    },
  };
  return { deps, invoices, created: () => created };
}

export async function rehearseMonthlyPlan(plan: MonthPlan, scenario: RehearsalScenario) {
  const copy = structuredClone(plan);
  if (scenario === "missing_agreement" && copy.items[0]) {
    copy.items[0] = { ...copy.items[0], input: null, state: "needs_review", problems: ["Simulated missing agreement: do not issue"] };
    copy.items[0].evidence.push(evidenceTag({ caseId: copy.items[0].caseId, kind: "agreement", status: "missing", observedAt: new Date().toISOString(), source: "rehearsal:missing_agreement", environment: "simulated", snapshot: null, note: "Agreement deliberately removed for this scenario; historical tags do not authorize a bill." }));
  }
  const gateway = simulatedMonthDeps(scenario);
  const first = await driveMonthLocally(createMonthSession(copy, gateway.deps));
  const createdOnFirst = gateway.created();
  const replay = await driveMonthLocally(createMonthSession(copy, gateway.deps));
  return {
    label: "Offline rehearsal: scripted tool orchestration and simulated PayPal/customer payments. No Gemini or PayPal calls.",
    scenario, first, replay, createdOnFirst, createdOnReplay: gateway.created() - createdOnFirst,
  };
}

export function runMonthlyRehearsal(scenario: RehearsalScenario) {
  return rehearseMonthlyPlan(loadMonthlyPlan("empty_simulated_ledger"), scenario);
}
