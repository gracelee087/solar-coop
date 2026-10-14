import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiPolicy } from "./gemini-policy";
import { demoProducer } from "./demo-group";

// No real Gemini call: every network request fails.
const input = { self: demoProducer, window: { floorCt: 9.3, ceilingCt: 16.97, viable: true }, history: [], round: 1, maxRounds: 5 };
afterEach(() => vi.restoreAllMocks());

describe("geminiPolicy when Gemini fails", () => {
  it("stops with an error in strict mode, so nothing rule-based is saved", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("network down"); });
    await expect(geminiPolicy({ onFailure: "throw" })(input)).rejects.toThrow();
  });

  it("falls back to the rule and says so in the default mode", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("network down"); });
    const p = await geminiPolicy()(input);
    expect(p.source.kind).toBe("rules");
  });
});
