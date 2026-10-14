import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findAgreement } from "./agreement";
import { averageMonthlyTotals } from "./allocate";
import { buildDashboard, negotiationLabel, recordedRun, whatIf, type NegotiationRun } from "./dashboard";
import { demoConsumers, demoGroup, demoProducer } from "./demo-group";
import { negotiate, ruleBasedPolicy, type NegotiationResult, type Offer } from "./negotiation";
import { monthlyPriceWindow } from "./pricing";
import { H25_FILE, loadHistoricalJunesFrom, loadRealJuneFrom, PVGIS_FILE, PVGIS_HISTORY_FILE } from "./real-data-files";
import { defaultSettings } from "./tariffs";

const dir = path.join(__dirname, "..", "data");
const haveData = [PVGIS_FILE, PVGIS_HISTORY_FILE, H25_FILE].every((f) => existsSync(path.join(dir, f)));
const sum = (xs: { cents: number }[]) => xs.reduce((t, x) => t + x.cents, 0);

const offer = (kind: "gemini" | "rules"): Offer => ({
  round: 1,
  from: "producer",
  priceCt: 12,
  message: "",
  reason: "",
  concessionCt: null,
  adjusted: false,
  source: kind === "gemini" ? { kind, model: "m" } : { kind },
});

describe("recordedRun", () => {
  it("replays the saved agreements as the recorded negotiation", () => {
    const offers = [offer("gemini"), offer("gemini")];
    const a = { period: "2026-06", neighbour: { id: "h2" }, priceCt: 12.95, negotiation: { offers, outcome: "Haus 12 accepted 12.95 ct/kWh." }, agreedAt: "2026-10-13T09:56:16Z" };
    const other = { ...a, period: "2026-07", neighbour: { id: "h1" }, agreedAt: "2026-10-14T00:00:00Z" };
    const run = recordedRun([a, other] as unknown as Parameters<typeof recordedRun>[0]);
    expect(run).toEqual({ mode: "recorded", at: "2026-10-14T00:00:00Z", negotiations: { h2: { agreed: true, priceCt: 12.95, offers, reason: "Haus 12 accepted 12.95 ct/kWh." } }, tips: {} });
    expect(negotiationLabel(run.negotiations.h2.offers, run.mode)).toBe("Recorded Gemini");
  });
});

describe("negotiationLabel", () => {
  it("tells recorded, live and fallback apart", () => {
    expect(negotiationLabel([offer("gemini"), offer("gemini")], "recorded")).toBe("Recorded Gemini");
    expect(negotiationLabel([offer("gemini"), offer("gemini")], "live")).toBe("Live Gemini");
    expect(negotiationLabel([offer("gemini"), offer("rules")], "live")).toBe("Live Gemini, rule-based fallback for 1 of 2 offers");
    expect(negotiationLabel([offer("rules")], "recorded")).toBe("Recorded: rule-based");
  });
});

describe.skipIf(!haveData)("buildDashboard (June 2026: expected from 2005–2022 weather, settled on 2023)", async () => {
  const supply = loadRealJuneFrom(dir, demoGroup);
  const history = loadHistoricalJunesFrom(dir, demoGroup);
  const expected = averageMonthlyTotals(demoGroup, history.map((m) => m.intervals));
  const negotiations: Record<string, NegotiationResult> = {};
  for (const h of demoGroup.households) {
    const w = monthlyPriceWindow(expected.sharedWh[h.id], defaultSettings);
    negotiations[h.id] = await negotiate(demoProducer, demoConsumers[h.id], w, { producer: ruleBasedPolicy, consumer: ruleBasedPolicy });
  }
  const run: NegotiationRun = { mode: "recorded", at: "2026-10-13T00:00:00Z", negotiations, tips: {} };
  const view = buildDashboard(supply, history, defaultSettings, run);
  const h2 = view.households.find((h) => h.id === "h2")!;

  it("uses 18 weather years for the expectation and keeps 2023 for the settlement", () => {
    expect(view.expectedYears).toHaveLength(18);
    expect(view.expectedYears).not.toContain("2023");
    expect(h2.settledSharedKWh).toBe(131.31);
    expect(h2.expectedSharedKWh).not.toBe(h2.settledSharedKWh);
  });

  it("negotiates inside the window of the expected shared energy", () => {
    expect(h2.window).toEqual(monthlyPriceWindow(expected.sharedWh.h2, defaultSettings));
    expect(h2.deal!.priceCt).toBeGreaterThanOrEqual(h2.window.floorCt);
    expect(h2.deal!.priceCt).toBeLessThanOrEqual(h2.window.ceilingCt);
  });

  it("settles the modelled supply month at the agreed price; the bill uses settled values", () => {
    const d = h2.deal!;
    expect(d.settled.breakdown.invoice.cents).toBe(Math.round(131.31 * d.priceCt));
    expect(d.expected.breakdown.invoice.unitCt).toBe(d.priceCt);
    expect(d.preview.amountEur).toBe((d.settled.breakdown.invoice.cents / 100).toFixed(2));
    expect(d.facts).toContain(`this costs ${d.preview.amountEur} €`);
    expect(d.facts).toContain("131.31 kWh");
  });

  it("keeps the issued invoice at its values from the time, apart from the preview", () => {
    expect(h2.issued).toMatchObject({ invoiceNumber: "ES-202606-H2-MV5R6U26", amountEur: "17.07", priceCt: 13 });
  });

  it("a settlement worse than expected stays a loss: the deal and its price are kept", () => {
    const dim = supply.map((iv) => ({ ...iv, generationWh: Math.round(iv.generationWh * 0.05), selfUseWh: Math.min(iv.selfUseWh, Math.round(iv.generationWh * 0.05)) }));
    const v = buildDashboard(dim, history, defaultSettings, run).households.find((h) => h.id === "h2")!;
    expect(v.deal).not.toBeNull();
    expect(v.deal!.priceCt).toBe(h2.deal!.priceCt);
    expect(v.deal!.expected.flows.neighbour.savingCents).toBeGreaterThan(0);
    expect(v.deal!.settled.flows.neighbour.savingCents).toBeLessThan(0);
  });

  it("a new negotiation result updates both outcomes, explanation and preview together", () => {
    const live: NegotiationRun = { ...run, mode: "live", negotiations: { ...negotiations, h2: { agreed: true, priceCt: 14, offers: [offer("gemini")], reason: "" } } };
    const v = buildDashboard(supply, history, defaultSettings, live).households.find((h) => h.id === "h2")!;
    expect(v.deal!.expected.breakdown.invoice.unitCt).toBe(14);
    expect(v.deal!.settled.breakdown.invoice.cents).toBe(Math.round(131.31 * 14));
    expect(v.deal!.facts).toContain("14.00 ct/kWh");
    expect(v.negotiationLabel).toBe("Live Gemini");
    expect(v.issued?.amountEur).toBe("17.07");
  });

  it("what-if at the agreed price reproduces the deal; another price changes only the preview", () => {
    const d = h2.deal!;
    const same = whatIf(h2, d.priceCt, defaultSettings)!;
    expect(same.expected).toEqual(d.expected);
    expect(same.settled).toEqual(d.settled);
    const before = JSON.stringify(h2);
    const cheaper = whatIf(h2, h2.window.floorCt, defaultSettings)!;
    expect(cheaper.settled.flows.neighbour.savingCents).toBeGreaterThan(d.settled.flows.neighbour.savingCents);
    expect(cheaper.settled.flows.producer.extraGainCents).toBeLessThan(d.settled.flows.producer.extraGainCents);
    expect(JSON.stringify(h2)).toBe(before); // deal, agreement and issued invoice untouched
    expect(whatIf(h2, h2.window.ceilingCt + 0.01, defaultSettings)).toBeNull();
    expect(whatIf(h2, h2.window.floorCt - 0.01, defaultSettings)).toBeNull();
    expect(whatIf(h2, NaN, defaultSettings)).toBeNull();
  });

  it("shows each side's goal and private limit as demo settings", () => {
    expect(h2.demoSettings).toEqual({
      producer: { name: "Haus 12", goal: demoProducer.persona, limitCt: 11, limitKind: "minimum" },
      neighbour: { name: "Haus 14", goal: demoConsumers.h2.persona, limitCt: 16, limitKind: "maximum" },
    });
  });

  it("marks a run's price as saved only when the saved agreement holds that price", () => {
    for (const h of view.households) {
      expect(h.agreement?.settlementKey ?? null).toBe(findAgreement(`ES-202606-P1-${h.id.toUpperCase()}`)?.settlementKey ?? null);
      expect(h.agreementStatus).toBe(h.agreement && h.deal && h.agreement.priceCt === h.deal.priceCt ? "saved" : "not saved");
    }
    const saved = findAgreement("ES-202606-P1-H2");
    if (saved) {
      const same: NegotiationRun = { ...run, negotiations: { ...negotiations, h2: { agreed: true, priceCt: saved.priceCt, offers: saved.negotiation.offers, reason: "" } } };
      expect(buildDashboard(supply, history, defaultSettings, same).households.find((h) => h.id === "h2")!.agreementStatus).toBe("saved");
      const other: NegotiationRun = { ...run, negotiations: { ...negotiations, h2: { agreed: true, priceCt: saved.priceCt + 1, offers: [], reason: "" } } };
      expect(buildDashboard(supply, history, defaultSettings, other).households.find((h) => h.id === "h2")!.agreementStatus).toBe("not saved");
    }
  });

  it("a failed negotiation leaves no earlier amounts behind", () => {
    const failed: NegotiationRun = { ...run, mode: "live", negotiations: { ...negotiations, h2: { agreed: false, priceCt: null, offers: [offer("gemini")], reason: "No agreement." } } };
    const v = buildDashboard(supply, history, defaultSettings, failed).households.find((h) => h.id === "h2")!;
    expect(v.deal).toBeNull();
    expect(v.issued?.amountEur).toBe("17.07");
  });

  it("summary figures equal the sums of the cost lines, for expected and settled", () => {
    for (const h of view.households) {
      for (const o of [h.deal!.expected, h.deal!.settled]) {
        expect(o.flows.neighbour.totalCents).toBe(o.breakdown.invoice.cents + sum(o.breakdown.neighbourOtherCosts));
        expect(o.flows.neighbour.savingCents).toBe(o.breakdown.neighbourAlternative.cents - o.flows.neighbour.totalCents);
        expect(o.flows.producer.netReceivedCents).toBe(o.breakdown.invoice.cents - sum(o.breakdown.producerCosts));
        expect(o.flows.producer.extraGainCents).toBe(o.flows.producer.netReceivedCents - o.breakdown.producerAlternative.cents);
        expect(o.flows.neighbour.savingCents).toBe(o.economics.consumerSavingCents);
      }
    }
  });

  it("keeps the producer's all-neighbour totals apart and equal to the sum of the single trades", () => {
    for (const which of ["expected", "settled"] as const) {
      expect(view.producerTotal[which].neighbours).toBe(3);
      for (const k of ["salesCents", "deductionsCents", "netReceivedCents", "gridAlternativeCents", "extraGainCents"] as const) {
        expect(view.producerTotal[which].flows[k]).toBe(view.households.reduce((t, h) => t + h.deal![which].flows.producer[k], 0));
      }
    }
  });

  it("lists what the totals leave out, with status, without adding it to the totals", () => {
    expect(h2.scope.map((x) => x.status)).toEqual(["not included", "unverified", "unverified", "not included"]);
    expect(h2.scope[0].cents).toBe(762); // 91.49 € per year ÷ 12
    expect(h2.scope[0].effect).toContain("Assumed to be the same");
    expect(h2.scope[2].cents).toBeNull(); // unknown stays unknown, not 0
    expect(view.producerScope.length).toBeGreaterThan(0);
  });

  it("has 30 days of 96 quarter-hours whose parts add up to the generation", () => {
    expect(view.days).toHaveLength(30);
    expect(view.days.every((d) => d.points.length === 96)).toBe(true);
    for (const p of view.days.flatMap((d) => d.points)) {
      const parts = p.selfUse + p.surplus + Object.values(p.shared).reduce((a, b) => a + b, 0);
      expect(Math.abs(parts - p.generation)).toBeLessThan(0.03); // each value rounded to 0.01 kW
    }
  });
});
