import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agreement } from "./agreement";
import { demoGroup } from "./demo-group";
import type { Explanation, ExplanationFacts } from "./explain";
import { previewExplanations } from "./explain-preview";
import { settlementKey } from "./invoice";
import { monthlyEconomics } from "./pricing";
import { defaultSettings } from "./tariffs";

// No Gemini or PayPal call: the explainer is a fake and fetch is stubbed to fail the test if anything reaches it.
const PERIOD = "2026-06";
const totals = {
  sharedWh: { h1: 91_000, h2: 131_310, h3: 116_000 },
  loadWh: { h1: 200_000, h2: 271_100, h3: 250_000 },
};
const names = { h1: "Haus 10", h2: "Haus 14", h3: "Haus 16" };
const agreementFor = (id: "h1" | "h2" | "h3", priceCt: number): Agreement => {
  const h = demoGroup.households.find((x) => x.id === id)!;
  return {
    settlementKey: settlementKey(PERIOD, demoGroup.producer.id, id),
    period: PERIOD,
    producer: { id: demoGroup.producer.id, name: "Haus 12" },
    neighbour: { id, name: h.name, allocationKey: h.key },
    priceCt,
    basis: { expectedSharedKWh: 100, weatherYears: "2005–2022", window: { floorCt: 9.3, ceilingCt: 16.97, viable: true } },
    negotiation: { rounds: 3, sources: [], offers: [], outcome: "agreed" },
    agreedAt: "2026-10-13T00:00:00.000Z",
  };
};
const fakeExplain = () =>
  vi.fn(async (f: ExplanationFacts): Promise<Explanation> => ({ text: `facts for ${f.neighbour}`, facts: "", tip: "midday", tipSource: "ai", model: "mock", error: null }));
const run = (store: Record<string, Agreement>, explain = fakeExplain()) => ({
  explain,
  result: previewExplanations({ group: demoGroup, names, period: PERIOD, totals, settings: defaultSettings, find: (k) => store[k] ?? null, explain }),
});

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    throw new Error("external call");
  });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe("previewExplanations", () => {
  it("explains at the saved agreement price with the same amounts the settlement computes", async () => {
    const store = Object.fromEntries((["h1", "h2", "h3"] as const).map((id, i) => [settlementKey(PERIOD, "p1", id), agreementFor(id, [12.4, 12.95, 13.31][i])]));
    const { explain, result } = run(store);
    const items = await result;
    expect(items.map((i) => i.status)).toEqual(["explained", "explained", "explained"]);
    for (const item of items) {
      if (item.status !== "explained") continue;
      const e = monthlyEconomics(totals.sharedWh[item.householdId as "h1"], item.agreement.priceCt, defaultSettings);
      expect(item.facts.priceCt).toBe(item.agreement.priceCt.toFixed(2));
      expect(item.facts.amountEur).toBe((e.energyChargeCents / 100).toFixed(2));
      expect(item.facts.savingEur).toBe((e.consumerSavingCents / 100).toFixed(2));
      expect(item.facts.sharedKWh).toBe(e.sharedKWh.toFixed(2));
    }
    expect(explain).toHaveBeenCalledTimes(3);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips a household without an agreement or with an unusable one, without asking the model", async () => {
    const h2Key = settlementKey(PERIOD, "p1", "h2");
    const h3Key = settlementKey(PERIOD, "p1", "h3");
    const store = {
      // h1: missing
      [h2Key]: agreementFor("h2", 20), // outside the price window
      [h3Key]: { ...agreementFor("h3", 13), period: "2026-05" }, // wrong period
    };
    const { explain, result } = run(store);
    const items = await result;
    expect(items.map((i) => i.status)).toEqual(["skipped", "skipped", "skipped"]);
    expect(items.map((i) => (i.status === "skipped" ? i.reason : ""))).toEqual([
      expect.stringContaining("no saved agreement"),
      expect.stringContaining("outside the window"),
      expect.stringContaining("not 2026-06"),
    ]);
    expect(explain).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a record filed under another household's key", async () => {
    const store = { [settlementKey(PERIOD, "p1", "h1")]: agreementFor("h2", 13) };
    const { explain, result } = run(store);
    const [h1] = await result;
    expect(h1).toMatchObject({ status: "skipped", reason: expect.stringContaining(`not ${settlementKey(PERIOD, "p1", "h1")}`) });
    expect(explain).not.toHaveBeenCalled();
  });
});
