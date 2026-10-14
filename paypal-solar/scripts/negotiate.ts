// Runs the producer agent against each neighbour agent with Gemini and prints the month's economics.
import "./env";
import { allocateAll, averageMonthlyTotals, monthlyTotals } from "../src/lib/allocate";
import { demoConsumers, demoGroup, demoProducer } from "../src/lib/demo-group";
import { geminiPolicy } from "../src/lib/gemini-policy";
import { negotiate, ruleBasedPolicy } from "../src/lib/negotiation";
import { monthlyEconomics, monthlyPriceWindow } from "../src/lib/pricing";
import { loadHistoricalJunes, loadRealJune } from "./real-june";
import { defaultSettings } from "../src/lib/tariffs";

const useRules = process.argv.includes("--rules");
const policy = useRules ? ruleBasedPolicy : geminiPolicy();
const eur = (c: number) => (c / 100).toFixed(2) + " €";

async function main() {
  console.log(`${useRules ? "Rule-based" : "Gemini"} agents\n`);

  const intervals = loadRealJune(demoGroup);
  const totals = monthlyTotals(demoGroup, intervals, allocateAll(demoGroup, intervals)); // modelled supply month
  // Before supply the price is negotiated on the expected shared energy (weather years 2005–2022).
  const expected = averageMonthlyTotals(demoGroup, loadHistoricalJunes(demoGroup).map((m) => m.intervals));

  for (const h of demoGroup.households) {
    const consumer = demoConsumers[h.id];
    const window = monthlyPriceWindow(expected.sharedWh[h.id], defaultSettings);
    console.log(`Price window for ${consumer.name}: ${window.floorCt} – ${window.ceilingCt} ct/kWh${window.viable ? "" : " (no deal)"}`);
    const r = await negotiate(demoProducer, consumer, window, { producer: policy, consumer: policy });
    console.log(`── ${demoProducer.name} ↔ ${consumer.name}`);
    for (const o of r.offers) {
      console.log(`  R${o.round} ${o.from.padEnd(8)} ${o.priceCt.toFixed(2)} ct${o.concessionCt === null ? "" : ` (moved ${o.concessionCt.toFixed(2)} ct)`}${o.adjusted ? " (clamped)" : ""}  "${o.message}"  reason: ${o.reason}`);
    }
    console.log(`  → ${r.reason}`);
    if (r.priceCt !== null) {
      const e = monthlyEconomics(totals.sharedWh[h.id], r.priceCt, defaultSettings);
      console.log(
        `  June: ${e.sharedKWh} kWh shared, bill ${eur(e.energyChargeCents)}, neighbour saves ${eur(e.consumerSavingCents)}, ` +
          `producer earns +${eur(e.producerGainCents)} vs feed-in, platform fee ${eur(e.platformFeeCents)}`,
      );
    }
    console.log();
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
