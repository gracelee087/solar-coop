import { describe, expect, it } from "vitest";
import { ALLOWED_ACTIONS, EXCEPTION_CASES, EXPECTED } from "./exception-cases";
import { ruleAction, score } from "./exception-rules";

describe("exception cases", () => {
  it("have unique ids and an answer for each case", () => {
    const ids = EXCEPTION_CASES.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(EXPECTED).sort()).toEqual([...ids].sort());
  });

  it("only expect actions allowed for their kind", () => {
    for (const x of EXCEPTION_CASES) expect(ALLOWED_ACTIONS[x.kind]).toContain(EXPECTED[x.id]);
  });

  it("rule baseline stays within the allowed actions", () => {
    for (const x of EXCEPTION_CASES) expect(ALLOWED_ACTIONS[x.kind]).toContain(ruleAction(x));
  });

  it("rule baseline misses exactly the cases decided by a note", () => {
    expect(score(EXCEPTION_CASES, EXPECTED, ruleAction)).toEqual({ correct: 9, total: 12, misses: ["X04", "X05", "X11"] });
  });
});
