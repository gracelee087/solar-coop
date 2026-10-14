// June explanations at the saved agreement price (scripts/agree.ts), the same terms scripts/settle.ts bills.
// No negotiation happens here. A missing or unusable agreement skips that neighbour without a Gemini call.
// Output is a settlement preview, not the explanation of an invoice issued earlier (those may carry another price).
import "./env";
import { findAgreement } from "../src/lib/agreement";
import { allocateAll, monthlyTotals } from "../src/lib/allocate";
import { demoConsumers, demoGroup } from "../src/lib/demo-group";
import { explainInvoice } from "../src/lib/explain";
import { PREVIEW_LABEL, previewExplanations } from "../src/lib/explain-preview";
import { defaultSettings } from "../src/lib/tariffs";
import { loadRealJune } from "./real-june";

const PERIOD = "2026-06";

async function main() {
  const intervals = loadRealJune(demoGroup);
  const totals = monthlyTotals(demoGroup, intervals, allocateAll(demoGroup, intervals)); // modelled supply month
  const names = Object.fromEntries(Object.entries(demoConsumers).map(([id, c]) => [id, c.name]));

  console.log(`${PREVIEW_LABEL} (not an issued invoice)\n`);
  const items = await previewExplanations({ group: demoGroup, names, period: PERIOD, totals, settings: defaultSettings, find: findAgreement, explain: explainInvoice });
  for (const item of items) {
    if (item.status === "skipped") {
      console.log(`── ${item.name}: ${item.reason}; no explanation\n`);
      continue;
    }
    const { facts, explanation: x } = item;
    console.log(`── ${item.name}: ${facts.sharedKWh} kWh × ${facts.priceCt} ct (agreed ${item.agreement.agreedAt}) = ${facts.amountEur} € — preview`);
    console.log(`tip: ${x.tip} (${x.tipSource}${x.model ? `, ${x.model}` : ""}${x.error ? `, error: ${x.error}` : ""})`);
    console.log(x.text + "\n");
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
