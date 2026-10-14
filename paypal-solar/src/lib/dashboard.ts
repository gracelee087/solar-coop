import { findAgreement, type Agreement } from "./agreement";
import { allocateAll, averageMonthlyTotals, monthlyTotals } from "./allocate";
import { kWh, outcome, type Outcome } from "./outcome";
import { demoConsumers, demoGroup, demoProducer } from "./demo-group";
import { factSentences, TIPS, type ExplanationFacts, type TipId } from "./explain";
import { settlementKey } from "./invoice";
import { findIssued, type IssuedInvoice } from "./issued";
import type { NegotiationResult, Offer, Party } from "./negotiation";
import {
  monthlyPriceWindow,
  regulatedGrossCt,
  type MoneyFlows,
  type MonthlyEconomics,
  type PriceWindow,
} from "./pricing";
import { TARIFFS, type PricingSettings } from "./tariffs";
import type { Interval } from "./types";

export type { Outcome } from "./outcome";
export { whatIf } from "./outcome";

export const PERIOD = "2026-06";
export const PERIOD_LABEL = "June 2026";

/** Negotiations and tip choices of one run, either recorded (src/data/recorded-demo.json) or live. */
export interface NegotiationRun {
  mode: "recorded" | "live";
  /** ISO time of the run. */
  at: string;
  negotiations: Record<string, NegotiationResult>;
  tips: Record<string, { tip: TipId; model: string | null }>;
}

/**
 * The recorded run shown by default: the saved agreements with their offers as negotiated. Households without
 * a saved agreement have no negotiation in it. Tips are not recorded yet, so each falls back to the default.
 */
export function recordedRun(agreements: Agreement[]): NegotiationRun {
  const negotiations: Record<string, NegotiationResult> = {};
  for (const a of agreements) {
    if (a.period !== PERIOD) continue;
    negotiations[a.neighbour.id] = { agreed: true, priceCt: a.priceCt, offers: a.negotiation.offers, reason: a.negotiation.outcome };
  }
  const at = agreements.map((a) => a.agreedAt).sort().at(-1) ?? "";
  return { mode: "recorded", at, negotiations, tips: {} };
}

/** How a negotiation was actually produced, so judges can tell recorded, live and fallback apart. */
export function negotiationLabel(offers: Offer[], mode: NegotiationRun["mode"]): string {
  const prefix = mode === "live" ? "Live" : "Recorded";
  const llm = offers.filter((o) => o.source.kind === "gemini").length;
  if (offers.length === 0) return `${prefix}: no offers`;
  if (llm === 0) return `${prefix}: rule-based`;
  if (llm === offers.length) return `${prefix} Gemini`;
  return `${prefix} Gemini, rule-based fallback for ${offers.length - llm} of ${offers.length} offers`;
}

/** A cost or income outside the calculation, shown with its status instead of being hidden or set to 0. */
export interface ScopeItem {
  label: string;
  status: "not included" | "unverified";
  /** Amount for the month in euro cents if it can be estimated, else null (unknown). */
  cents: number | null;
  /** How it would change the totals or the saving. */
  effect: string;
  source?: string;
}

/** What the neighbour's totals leave out. The totals cover only the shared energy, not the whole bill. */
export function neighbourScope(usedWh: number, sharedWh: number, s: PricingSettings): ScopeItem[] {
  const restKWh = (usedWh - sharedWh) / 1000;
  return [
    {
      label: "Base fee of the supply contract (Mainova)",
      status: "not included",
      cents: Math.round((TARIFFS.supplyBaseFeeEurPerYear.value * 100) / 12),
      effect:
        "Assumed to be the same with and without sharing, so it is left out of the saving; the terms of the residual supply contract under energy sharing were not verified. Includes the grid base fee of 34.98 € per year net. The whole bill is higher by this amount.",
      source: TARIFFS.supplyBaseFeeEurPerYear.source,
    },
    {
      label: `Electricity for the rest of the consumption (${restKWh.toFixed(2)} kWh)`,
      status: "unverified",
      cents: Math.round(restKWh * s.defaultSupplyGrossCt),
      effect:
        "Bought from the supplier either way. Estimated at default-supply price. The Bundesnetzagentur warns that suppliers, including the default supplier, may charge more for such a residual supply contract; the actual price was not verified. If it is higher, the saving shrinks by the difference.",
      source: "https://www.bundesnetzagentur.de/1107632",
    },
    {
      label: "Service-provider fee charged to the neighbour",
      status: "unverified",
      cents: null,
      effect: "The provider model used charges the producer only (secondary source). A fee for the neighbour would lower the saving by the same amount.",
      source: TARIFFS.platformFeeCt.source,
    },
    {
      label: "One-off costs (smart-meter installation, contract set-up)",
      status: "not included",
      cents: null,
      effect: "Unknown; would lower the saving in the month they occur.",
    },
  ];
}

/** What the producer's totals leave out. */
export function producerScope(): ScopeItem[] {
  return [
    {
      label: "Feed-in income for the surplus nobody used",
      status: "not included",
      cents: null,
      effect: "The same with and without sharing, so the extra gain is unchanged.",
    },
    {
      label: "Value of the producer's own solar use",
      status: "not included",
      cents: null,
      effect: "Not affected by sharing; the producer uses its own power first.",
    },
    {
      label: "Income tax on the extra income",
      status: "not included",
      cents: null,
      effect: "Depends on the producer's situation; not tax advice.",
    },
  ];
}

export interface HouseholdView {
  id: string;
  name: string;
  key: number;
  annualKWh: number;
  /** Before supply: average of the weather years, each allocated on its own. */
  expectedSharedKWh: number;
  /** Modelled supply month (settlement basis). */
  settledSharedKWh: number;
  /** Unrounded energies behind the two figures above, for the price-only what-if. */
  energyWh: { expectedShared: number; expectedUsed: number; settledShared: number; settledUsed: number };
  /** Computed from the expected shared energy, before supply. */
  window: PriceWindow;
  negotiation: NegotiationResult;
  negotiationLabel: string;
  /**
   * Fictional-household demo settings for the judges' expandable section: each side's goal and private limit.
   * Neither side's agent is given the other side's limit.
   */
  demoSettings: { producer: PartySetting; neighbour: PartySetting };
  /** Everything below follows this run's agreed price; null when there was no deal (no old amounts remain). */
  deal: {
    priceCt: number;
    /** Before supply: the agreed price applied to the expected shared energy (average of 2005–2022 weather). */
    expected: Outcome;
    /**
     * Settlement: the same agreed price applied to the shared energy of the modelled supply month (June 2023
     * weather). It can be worse than expected, even a loss; the agreement is not changed or erased afterwards.
     */
    settled: Outcome;
    /** Bill explanation of the settled month. */
    facts: string;
    tip: { id: TipId; text: string; model: string | null };
    /** New calculation of the settled month; never issued from the dashboard. */
    preview: { amountEur: string };
  } | null;
  /** Saved agreement for this settlement (what the settlement bills), or null. */
  agreement: Agreement | null;
  /** "saved" only when this run's price is the saved agreement's price; a live run is otherwise "not saved". */
  agreementStatus: "saved" | "not saved";
  /** Invoice issued earlier for this settlement, shown with its values at the time. */
  issued: (IssuedInvoice & { settlementKey: string }) | null;
  /** What the neighbour's settled totals leave out (shown even without a deal). */
  scope: ScopeItem[];
}

export interface ChartPoint {
  /** Local time "HH:MM". */
  t: string;
  /** Average power in the quarter-hour, kW. */
  generation: number;
  selfUse: number;
  surplus: number;
  shared: Record<string, number>;
}

type PartySetting = { name: string; goal: string; limitCt: number; limitKind: "minimum" | "maximum" };
const partySetting = (p: Party): PartySetting => ({ name: p.name, goal: p.persona, limitCt: p.limitCt, limitKind: p.role === "producer" ? "minimum" : "maximum" });

type ProducerTotals = { neighbours: number; flows: MoneyFlows["producer"] };

export interface DashboardView {
  period: string;
  periodLabel: string;
  producer: { name: string; kWp: number; annualKWh: number };
  run: { mode: NegotiationRun["mode"]; at: string };
  /** Weather years behind the expected values. */
  expectedYears: string[];
  /** Modelled supply month (settlement basis). */
  month: { generationKWh: number; selfUseKWh: number; surplusKWh: number };
  households: HouseholdView[];
  /** Producer totals over all neighbours with a deal; kept apart from any single neighbour's figures. */
  producerTotal: { expected: ProducerTotals; settled: ProducerTotals };
  producerScope: ScopeItem[];
  /** Modelled supply month: one entry per day, 96 quarter-hours each. */
  days: { date: string; points: ChartPoint[] }[];
}

const kW = (wh: number) => Math.round((wh * 4) / 10) / 100; // Wh per 15 min → kW, 2 decimals

export function explanationFacts(name: string, usedWh: number, sharedWh: number, priceCt: number, e: MonthlyEconomics, s: PricingSettings): ExplanationFacts {
  return {
    neighbour: name,
    producer: demoProducer.name,
    period: PERIOD_LABEL,
    usedKWh: (usedWh / 1000).toFixed(1),
    sharedKWh: e.sharedKWh.toFixed(2),
    coveragePct: ((100 * sharedWh) / usedWh).toFixed(0),
    priceCt: priceCt.toFixed(2),
    amountEur: (e.energyChargeCents / 100).toFixed(2),
    defaultSupplyCt: s.defaultSupplyGrossCt.toFixed(2),
    regulatedCt: regulatedGrossCt(s).toFixed(2),
    savingEur: (e.consumerSavingCents / 100).toFixed(2),
    smartMeterEur: (TARIFFS.smartMeterUserEurPerYear.value / 12).toFixed(2),
  };
}

function producerTotals(households: HouseholdView[], pick: (d: NonNullable<HouseholdView["deal"]>) => Outcome): ProducerTotals {
  const t: ProducerTotals = { neighbours: 0, flows: { salesCents: 0, deductionsCents: 0, netReceivedCents: 0, gridAlternativeCents: 0, extraGainCents: 0 } };
  for (const h of households) {
    if (!h.deal) continue;
    t.neighbours += 1;
    for (const k of Object.keys(t.flows) as (keyof MoneyFlows["producer"])[]) t.flows[k] += pick(h.deal).flows.producer[k];
  }
  return t;
}

/**
 * Everything the dashboard shows, derived from one negotiation run. The price window and the negotiation use
 * the expected month (several weather years, each allocated on its own, then averaged); the settlement applies
 * the agreed price to the modelled supply month. Swapping the run (recorded → live) recomputes gains, breakdown,
 * explanation and preview together; a failed deal leaves no old amounts behind. Issued invoices are independent
 * of the run and keep their values at the time.
 */
export function buildDashboard(
  supplyMonth: Interval[],
  historicalMonths: { year: string; intervals: Interval[] }[],
  s: PricingSettings,
  run: NegotiationRun,
): DashboardView {
  const allocs = allocateAll(demoGroup, supplyMonth);
  const actual = monthlyTotals(demoGroup, supplyMonth, allocs);
  const expected = averageMonthlyTotals(demoGroup, historicalMonths.map((m) => m.intervals));

  const households = demoGroup.households.map((h): HouseholdView => {
    const negotiation = run.negotiations[h.id] ?? { agreed: false, priceCt: null, offers: [], reason: "Not negotiated." };
    const key = settlementKey(PERIOD, demoGroup.producer.id, h.id);
    const issued = findIssued(key);
    const agreement = findAgreement(key);
    let deal: HouseholdView["deal"] = null;
    if (negotiation.agreed && negotiation.priceCt !== null) {
      const priceCt = negotiation.priceCt;
      const settled = outcome(actual.loadWh[h.id], actual.sharedWh[h.id], priceCt, s);
      const tipChoice = run.tips[h.id] ?? { tip: "midday" as TipId, model: null };
      deal = {
        priceCt,
        expected: outcome(expected.loadWh[h.id], expected.sharedWh[h.id], priceCt, s),
        settled,
        facts: factSentences(explanationFacts(demoConsumers[h.id].name, actual.loadWh[h.id], actual.sharedWh[h.id], priceCt, settled.economics, s)),
        tip: { id: tipChoice.tip, text: TIPS[tipChoice.tip], model: tipChoice.model },
        preview: { amountEur: (settled.economics.energyChargeCents / 100).toFixed(2) },
      };
    }
    return {
      id: h.id,
      name: h.name,
      key: h.key,
      annualKWh: h.annualKWh,
      expectedSharedKWh: kWh(expected.sharedWh[h.id]),
      settledSharedKWh: kWh(actual.sharedWh[h.id]),
      energyWh: {
        expectedShared: expected.sharedWh[h.id],
        expectedUsed: expected.loadWh[h.id],
        settledShared: actual.sharedWh[h.id],
        settledUsed: actual.loadWh[h.id],
      },
      window: monthlyPriceWindow(expected.sharedWh[h.id], s),
      negotiation,
      negotiationLabel: negotiationLabel(negotiation.offers, run.mode),
      demoSettings: { producer: partySetting(demoProducer), neighbour: partySetting(demoConsumers[h.id]) },
      deal,
      agreement,
      agreementStatus: agreement !== null && deal !== null && agreement.priceCt === deal.priceCt ? "saved" : "not saved",
      issued: issued ? { ...issued, settlementKey: key } : null,
      scope: neighbourScope(actual.loadWh[h.id], actual.sharedWh[h.id], s),
    };
  });

  const days: DashboardView["days"] = [];
  allocs.forEach((a, i) => {
    const date = a.start.slice(0, 10);
    if (i % 96 === 0) days.push({ date, points: [] });
    days[days.length - 1].points.push({
      t: a.start.slice(11, 16),
      generation: kW(a.generationWh),
      selfUse: kW(a.selfUseWh),
      surplus: kW(a.surplusWh),
      shared: Object.fromEntries(demoGroup.households.map((h) => [h.id, kW(a.sharedWh[h.id])])),
    });
  });

  return {
    period: PERIOD,
    periodLabel: PERIOD_LABEL,
    producer: { name: demoGroup.producer.name, kWp: demoGroup.producer.kWp, annualKWh: demoGroup.producer.annualKWh },
    run: { mode: run.mode, at: run.at },
    expectedYears: historicalMonths.map((m) => m.year),
    month: { generationKWh: kWh(actual.generationWh), selfUseKWh: kWh(actual.selfUseWh), surplusKWh: kWh(actual.surplusWh) },
    households,
    producerTotal: { expected: producerTotals(households, (d) => d.expected), settled: producerTotals(households, (d) => d.settled) },
    producerScope: producerScope(),
    days,
  };
}
