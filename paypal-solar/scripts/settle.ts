// June settlement: for each neighbour with a saved agreement (scripts/agree.ts), the producer's agent invoices
// the agreed price × modelled shared energy via PayPal sandbox. No negotiation happens here.
import "./env";
import { checkAgreement, findAgreement } from "../src/lib/agreement";
import { allocateAll, monthlyTotals } from "../src/lib/allocate";
import { demoConsumers, demoGroup, demoProducer, sandboxEmails } from "../src/lib/demo-group";
import { validateJuneIntervals } from "../src/lib/data-validation";
import { settlementKey } from "../src/lib/invoice";
import { monthlyEconomics } from "../src/lib/pricing";
import { settleWithAgent } from "../src/lib/settlement-agent";
import { defaultSettings } from "../src/lib/tariffs";
import { loadRealJune } from "./real-june";

const PERIOD = "2026-06";
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

async function main() {
  const intervals = loadRealJune(demoGroup);
  validateJuneIntervals(demoGroup, intervals);
  const totals = monthlyTotals(demoGroup, intervals, allocateAll(demoGroup, intervals)); // modelled supply month

  for (const h of demoGroup.households) {
    if (only && h.id !== only) continue;
    const consumer = demoConsumers[h.id];
    const key = settlementKey(PERIOD, demoGroup.producer.id, h.id);
    const agreement = findAgreement(key);
    if (!agreement) {
      console.log(`${consumer.name}: no saved agreement for ${key}; nothing settled`);
      continue;
    }
    const problems = checkAgreement(agreement, demoGroup, PERIOD);
    if (problems.length) {
      console.log(`${consumer.name}: agreement ${key} not usable: ${problems.join("; ")}`);
      continue;
    }
    const e = monthlyEconomics(totals.sharedWh[h.id], agreement.priceCt, defaultSettings);
    const result = await settleWithAgent({
      producer: { name: demoProducer.name, email: sandboxEmails.p1 },
      consumer: { name: consumer.name, email: sandboxEmails[h.id] },
      period: PERIOD,
      sharedKWh: e.sharedKWh,
      priceCt: agreement.priceCt,
      amountCents: e.energyChargeCents,
      invoiceNumber: key, // fixed per settlement: re-running never bills twice
      invoiceDate: "2026-07-01",
    });
    console.log(`${consumer.name}: ${e.sharedKWh} kWh × ${agreement.priceCt} ct (agreed ${agreement.agreedAt}) = ${(e.energyChargeCents / 100).toFixed(2)} €`);
    console.log(`  outcome ${result.outcome}; agent (${result.model ?? "-"}) tools: ${result.toolCalls.join(" → ") || "-"}`);
    console.log(`  invoice ${result.invoiceId} status ${result.invoice?.status ?? "-"} amount ${result.invoice?.amount.value ?? "-"}`);
    console.log(`  pay link: ${result.invoice?.detail.metadata?.recipient_view_url ?? "-"}`);
    console.log(`  check: ${result.problems.length ? "PROBLEMS " + result.problems.join("; ") : "OK"}\n`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
