import { describe, expect, it } from "vitest";
import { addAgreement, checkAgreement, checkBeforeSave, makeAgreement, type Agreement } from "./agreement";
import { demoGroup } from "./demo-group";
import type { NegotiationResult } from "./negotiation";

const window = { floorCt: 9.3, ceilingCt: 16.97, viable: true };
const result: NegotiationResult = {
  agreed: true,
  priceCt: 12.65,
  offers: [
    { round: 1, from: "producer", priceCt: 15, message: "", reason: "", concessionCt: null, adjusted: false, source: { kind: "gemini", model: "gemini-x" } },
    { round: 1, from: "consumer", priceCt: 12.65, message: "", reason: "", concessionCt: null, adjusted: false, source: { kind: "rules", reason: "quota" } },
  ],
  reason: "",
};
const make = (r: NegotiationResult = result) =>
  makeAgreement({ period: "2026-06", group: demoGroup, householdId: "h2", result: r, expectedSharedKWh: 123.02, weatherYears: "2005–2022", window, agreedAt: "2026-10-13T10:00:00Z" });

describe("agreement record", () => {
  it("keeps price, month, parties, allocation key, basis, sources and time", () => {
    expect(make()).toEqual({
      settlementKey: "ES-202606-P1-H2",
      period: "2026-06",
      producer: { id: "p1", name: "Rooftop PV (Haus 12)" },
      neighbour: { id: "h2", name: "Haus 14", allocationKey: 0.3 },
      priceCt: 12.65,
      basis: { expectedSharedKWh: 123.02, weatherYears: "2005–2022", window },
      negotiation: {
        rounds: 2,
        sources: [{ kind: "gemini", model: "gemini-x" }, { kind: "rules", reason: "quota" }],
        offers: result.offers,
        outcome: result.reason,
      },
      agreedAt: "2026-10-13T10:00:00Z",
    });
  });

  it("is not made without a deal", () => {
    expect(make({ ...result, agreed: false, priceCt: null })).toBeNull();
  });

  it("can be settled only with the same group, month and a price inside its window", () => {
    const a = make()!;
    expect(checkAgreement(a, demoGroup, "2026-06")).toEqual([]);
    expect(checkAgreement(a, demoGroup, "2026-07")).toEqual(["agreement is for 2026-06, not 2026-07"]);
    const moved = { ...demoGroup, households: demoGroup.households.map((h) => (h.id === "h2" ? { ...h, key: 0.4 } : h)) };
    expect(checkAgreement(a, moved, "2026-06")).toEqual(["allocation key changed from 0.3 to 0.4"]);
    expect(checkAgreement({ ...a, priceCt: 20 }, demoGroup, "2026-06")).toEqual(["price 20 ct is outside the window 9.3–16.97 ct"]);
    expect(checkAgreement({ ...a, priceCt: NaN }, demoGroup, "2026-06")).toEqual(["price is not a number"]);
    expect(checkAgreement({ ...a, settlementKey: "ES-202606-P1-H1" }, demoGroup, "2026-06")).toHaveLength(1);
  });

  it("never replaces a saved agreement", () => {
    const a = make()!;
    const first = addAgreement({}, a);
    expect("store" in first && first.store[a.settlementKey].priceCt).toBe(12.65);
    const store = (first as { store: Record<string, Agreement> }).store;
    const second = addAgreement(store, { ...a, priceCt: 14 });
    expect(second).toEqual({ error: "ES-202606-P1-H2 was already agreed at 12.65 ct on 2026-10-13T10:00:00Z" });
  });

  it("is saved as a Gemini agreement only when every offer came from Gemini and the price is inside both limits", () => {
    const limits = { producerMinCt: 11, neighbourMaxCt: 16 };
    const mixed = make()!; // second offer is a rule-based fallback
    expect(checkBeforeSave(mixed, demoGroup, "2026-06", limits)).toEqual(["offer 2 was not proposed by Gemini"]);
    const gemini = make({ ...result, offers: result.offers.map((o) => ({ ...o, source: { kind: "gemini" as const, model: "gemini-x" } })) })!;
    expect(checkBeforeSave(gemini, demoGroup, "2026-06", limits)).toEqual([]);
    expect(checkBeforeSave(gemini, demoGroup, "2026-06", { producerMinCt: 13, neighbourMaxCt: 16 })).toEqual([
      "price 12.65 ct is outside the private limits 13–16 ct",
    ]);
  });
});
