import { describe, expect, it } from "vitest";
import { negotiate, ruleBasedPolicy, type Party, type Policy } from "./negotiation";
import { priceWindow } from "./pricing";
import { defaultSettings } from "./tariffs";

const window = priceWindow(defaultSettings); // 8.70 .. 19.00
const producer: Party = { role: "producer", name: "Haus 12", limitCt: 12, persona: "" };
const consumer: Party = { role: "consumer", name: "Haus 10", limitCt: 15, persona: "" };
const rules = { producer: ruleBasedPolicy, consumer: ruleBasedPolicy };

describe("negotiate", () => {
  it("reaches a deal inside both private limits when they overlap", async () => {
    const r = await negotiate(producer, consumer, window, rules);
    expect(r.agreed).toBe(true);
    expect(r.priceCt!).toBeGreaterThanOrEqual(producer.limitCt);
    expect(r.priceCt!).toBeLessThanOrEqual(consumer.limitCt);
  });

  it("ends without a deal when limits do not overlap", async () => {
    const r = await negotiate({ ...producer, limitCt: 16 }, { ...consumer, limitCt: 14 }, window, rules);
    expect(r.agreed).toBe(false);
    expect(r.priceCt).toBeNull();
  });

  it("refuses to start when the window is not viable", async () => {
    const r = await negotiate(producer, consumer, { floorCt: 20, ceilingCt: 19, viable: false }, rules);
    expect(r.agreed).toBe(false);
    expect(r.offers).toHaveLength(0);
  });

  it("clamps a misbehaving policy to the limits and never lets it backtrack", async () => {
    const greedy: Policy = async ({ round }) => ({ priceCt: round === 1 ? 99 : 30 + round, message: "more!", reason: "", source: { kind: "rules" } });
    const lowball: Policy = async () => ({ priceCt: -5, message: "free please", reason: "", source: { kind: "rules" } });
    const r = await negotiate(producer, consumer, window, { producer: greedy, consumer: lowball }, 4);
    for (const o of r.offers) {
      expect(o.priceCt).toBeGreaterThanOrEqual(window.floorCt);
      expect(o.priceCt).toBeLessThanOrEqual(window.ceilingCt);
      if (o.from === "producer") expect(o.priceCt).toBeGreaterThanOrEqual(producer.limitCt);
      if (o.from === "consumer") expect(o.priceCt).toBeLessThanOrEqual(consumer.limitCt);
    }
    expect(r.offers.every((o) => o.adjusted)).toBe(true);
    const asks = r.offers.filter((o) => o.from === "producer").map((o) => o.priceCt);
    expect(asks).toEqual([...asks].sort((a, b) => b - a)); // non-increasing
  });

  it("computes each concession from the guarded prices, not from the policy's words", async () => {
    const claims: Policy = async ({ self, round }) => ({
      priceCt: self.role === "producer" ? 18 - round : 9 + round,
      message: "I conceded a lot!",
      reason: "Big step.",
      source: { kind: "rules" },
    });
    const r = await negotiate(producer, consumer, window, { producer: claims, consumer: claims }, 5);
    const byRole = (role: "producer" | "consumer") => r.offers.filter((o) => o.from === role);
    for (const role of ["producer", "consumer"] as const) {
      const own = byRole(role);
      expect(own[0].concessionCt).toBeNull();
      own.slice(1).forEach((o, i) => expect(o.concessionCt).toBe(Math.round(Math.abs(own[i].priceCt - o.priceCt) * 100) / 100));
    }
    expect(r.offers.every((o) => o.reason === "Big step.")).toBe(true);
  });

  it("gives the rule-based reason without numbers", async () => {
    const r = await negotiate(producer, consumer, window, rules);
    expect(r.offers[0].reason).toBe("Opens at the edge of the public price window.");
    expect(r.offers.every((o) => !/\d/.test(o.reason))).toBe(true);
  });
});
