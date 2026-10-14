import { describe, expect, it } from "vitest";
import { ALLOWED_ACTIONS, EXCEPTION_CASES } from "./exception-cases";
import { HOLDOUT_CASES, HOLDOUT_EXPECTED } from "./exception-holdout";
import { ruleAction } from "./exception-rules";

describe("held-out exception cases", () => {
  it("are new ids with accepted answers allowed for their kind", () => {
    const ids = HOLDOUT_CASES.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => EXCEPTION_CASES.some((x) => x.id === id))).toBe(false);
    for (const x of HOLDOUT_CASES) {
      expect(HOLDOUT_EXPECTED[x.id].length).toBeGreaterThan(0);
      for (const a of HOLDOUT_EXPECTED[x.id]) expect(ALLOWED_ACTIONS[x.kind]).toContain(a);
    }
  });

  it("rule baseline score on the held-out cases", () => {
    const misses = HOLDOUT_CASES.filter((x) => !HOLDOUT_EXPECTED[x.id].includes(ruleAction(x))).map((x) => x.id);
    expect(misses).toEqual(["Y01", "Y04", "Y07", "Y11"]); // 8/12
  });
});
