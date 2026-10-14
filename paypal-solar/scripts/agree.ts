// Before supply: Gemini agents negotiate each neighbour's price on the expected shared energy; the agreed terms
// are checked and saved with every offer, reason and model name. Free-tier Gemini only.
// If a Gemini call fails, the run stops: nothing rule-based is saved. Saved agreements are never overwritten.
// The settlement (scripts/settle.ts) reads only these records.
//   npx tsx scripts/agree.ts [--only=h2]
import "./env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkBeforeSave, makeAgreement, type AgreementStore } from "../src/lib/agreement";
import { saveAgreementToFile } from "../src/lib/agreement-file";
import { averageMonthlyTotals } from "../src/lib/allocate";
import { demoConsumers, demoGroup, demoProducer } from "../src/lib/demo-group";
import { geminiPolicy } from "../src/lib/gemini-policy";
import { settlementKey } from "../src/lib/invoice";
import { negotiate } from "../src/lib/negotiation";
import { monthlyPriceWindow } from "../src/lib/pricing";
import { defaultSettings } from "../src/lib/tariffs";
import { loadHistoricalJunes } from "./real-june";

const FILE = path.join(__dirname, "..", "src", "data", "agreements.json");
const PERIOD = "2026-06";
const NOTE = "Demo replay: June 2026 is past, so the agreement is made now on the expected values, as it would be before supply.";
const policy = geminiPolicy({ onFailure: "throw" });
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

async function main() {
  const history = loadHistoricalJunes(demoGroup);
  const expected = averageMonthlyTotals(demoGroup, history.map((m) => m.intervals));
  const weatherYears = `${history[0].year}–${history[history.length - 1].year}`;

  for (const h of demoGroup.households) {
    if (only && h.id !== only) continue;
    const file = JSON.parse(readFileSync(FILE, "utf8")) as { note: string; agreements: AgreementStore };
    const key = settlementKey(PERIOD, demoGroup.producer.id, h.id);
    if (file.agreements[key]) {
      console.log(`${h.name}: ${key} already agreed at ${file.agreements[key].priceCt} ct; skipped (no overwrite, no Gemini call)`);
      continue;
    }
    const consumer = demoConsumers[h.id];
    const window = monthlyPriceWindow(expected.sharedWh[h.id], defaultSettings);
    let result;
    try {
      result = await negotiate(demoProducer, consumer, window, { producer: policy, consumer: policy });
    } catch (e) {
      console.error(`${h.name}: Gemini call failed, run stopped; nothing saved for ${key}: ${(e as Error).message.slice(0, 200)}`);
      process.exit(1);
    }
    for (const o of result.offers) {
      const model = o.source.kind === "gemini" ? o.source.model : "rules";
      console.log(`  R${o.round} ${o.from.padEnd(8)} ${o.priceCt.toFixed(2)} ct${o.concessionCt === null ? "" : ` (moved ${o.concessionCt.toFixed(2)})`}${o.adjusted ? " (clamped)" : ""} [${model}] "${o.message}" reason: ${o.reason}`);
    }
    const agreement = makeAgreement({
      period: PERIOD,
      group: demoGroup,
      householdId: h.id,
      result,
      expectedSharedKWh: Math.round(expected.sharedWh[h.id] / 10) / 100,
      weatherYears,
      window,
      agreedAt: new Date().toISOString(),
      note: NOTE,
    });
    if (!agreement) {
      console.log(`${h.name}: no deal (${result.reason}); nothing saved`);
      continue;
    }
    const problems = checkBeforeSave(agreement, demoGroup, PERIOD, { producerMinCt: demoProducer.limitCt, neighbourMaxCt: consumer.limitCt });
    if (problems.length) {
      console.error(`${h.name}: not saved, checks failed: ${problems.join("; ")}`);
      process.exit(1);
    }
    // Read again under a lock right before writing; the check above is only there to save Gemini quota.
    const saved = saveAgreementToFile(FILE, agreement);
    if (!saved.saved) {
      console.log(`${h.name}: not saved, ${saved.error}`);
      continue;
    }
    console.log(`${h.name}: agreed ${agreement.priceCt} ct (window ${window.floorCt}–${window.ceilingCt}), checks passed, saved as ${key}\n`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
