import { checkAgreement, type Agreement } from "./agreement";
import type { MonthlyTotals } from "./allocate";
import { explanationFacts } from "./dashboard";
import type { Explanation, ExplanationFacts } from "./explain";
import { settlementKey } from "./invoice";
import { monthlyEconomics } from "./pricing";
import type { PricingSettings } from "./tariffs";
import type { SharingGroup } from "./types";

export const PREVIEW_LABEL = "Settlement preview explanation based on the saved agreement";

export type PreviewExplanation =
  | { householdId: string; name: string; status: "explained"; settlementKey: string; agreement: Agreement; facts: ExplanationFacts; explanation: Explanation }
  | { householdId: string; name: string; status: "skipped"; settlementKey: string; reason: string };

/**
 * Explanations at the saved agreement price, the same terms the settlement uses: no negotiation happens here. A
 * missing or unusable agreement skips that household before the model is asked. This is a preview of what settling
 * on the saved agreement would bill; invoices issued earlier may carry a different price.
 */
export async function previewExplanations(deps: {
  group: SharingGroup;
  names: Record<string, string>;
  period: string;
  totals: Pick<MonthlyTotals, "sharedWh" | "loadWh">;
  settings: PricingSettings;
  find: (key: string) => Agreement | null;
  explain: (f: ExplanationFacts) => Promise<Explanation>;
}): Promise<PreviewExplanation[]> {
  const out: PreviewExplanation[] = [];
  for (const h of deps.group.households) {
    const name = deps.names[h.id] ?? h.name;
    const key = settlementKey(deps.period, deps.group.producer.id, h.id);
    const agreement = deps.find(key);
    if (!agreement) {
      out.push({ householdId: h.id, name, status: "skipped", settlementKey: key, reason: `no saved agreement for ${key}` });
      continue;
    }
    const problems = checkAgreement(agreement, deps.group, deps.period);
    if (agreement.settlementKey !== key) problems.push(`record is for ${agreement.settlementKey}, not ${key}`);
    if (problems.length) {
      out.push({ householdId: h.id, name, status: "skipped", settlementKey: key, reason: `agreement ${key} not usable: ${problems.join("; ")}` });
      continue;
    }
    const e = monthlyEconomics(deps.totals.sharedWh[h.id], agreement.priceCt, deps.settings);
    const facts = explanationFacts(name, deps.totals.loadWh[h.id], deps.totals.sharedWh[h.id], agreement.priceCt, e, deps.settings);
    out.push({ householdId: h.id, name, status: "explained", settlementKey: key, agreement, facts, explanation: await deps.explain(facts) });
  }
  return out;
}
