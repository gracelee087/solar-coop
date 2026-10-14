// Request-shape and fixture tests for the real-output pairs. Mocked; says nothing about Jev's accuracy.
import { describe, expect, it, vi } from "vitest";
import { explanationRequests, review, type Fetch } from "./jev";
import { EXPLANATIONS } from "./real-outputs";

const ex = (id: string) => EXPLANATIONS.find((e) => e.id === id)!;

describe("real-output pairs (frozen before any Jev call)", () => {
  it("pair each original with a version that changes one named thing", () => {
    expect(EXPLANATIONS.map((e) => e.id)).toEqual([
      "Y01-original", "Y01-fixed", "Y04-original", "Y04-fixed", "Y07-original", "Y07-fixed", "Y11-original", "Y11-fixed",
      "X04-original", "X04-fixed", "Y12-original", "Y12-fixed",
    ]);
    for (const e of EXPLANATIONS) for (const q of e.questions) expect(e.expected[q]).toBeDefined();
    expect(ex("Y04-original")).toMatchObject({ reason: "A note disputes the amount.", cited: ["F3"], action: "escalate" });
    expect(ex("Y04-fixed").cited).toEqual(["F3", "N1"]);
    expect(ex("X04-original")).toMatchObject({ action: "remind" });
    expect(ex("X04-fixed")).toMatchObject({ action: "escalate", reason: ex("X04-original").reason, unverified: ex("X04-original").unverified });
    expect(ex("Y12-original").expected).toEqual({ case_support: "supports", omits_relevant: true }); // omission, not a contradiction
  });
});

describe("explanation requests", () => {
  it("ask about the whole case and about the cited items in separate requests", () => {
    const [whole, cited] = explanationRequests(ex("Y04-original"));
    expect(whole.part).toBe("case");
    expect(JSON.stringify(whole.req.state)).toContain("N1");
    expect(Object.keys(whole.req.questions)).toEqual(["case_support"]);
    expect(cited.part).toBe("cited");
    expect(Object.keys(cited.req.state as object)).toEqual(["reason", "cited_evidence"]);
    expect((cited.req.state as { cited_evidence: { id: string }[] }).cited_evidence.map((i) => i.id)).toEqual(["F3"]);
  });

  it("judge the X04 action against the operator rules, and Y12 for omission", () => {
    const [x04] = explanationRequests(ex("X04-original"));
    expect(Object.keys(x04.req.questions)).toEqual(["rule_fit"]);
    expect((x04.req.state as { operator_rules: string[] }).operator_rules.some((r) => r.includes("never remind"))).toBe(true);
    expect(Object.keys(explanationRequests(ex("Y12-original"))[0].req.questions)).toEqual(["case_support", "omits_relevant"]);
  });

  it("keeps every answer, and sends low confidence to a person", async () => {
    const f: Fetch = vi.fn(async () => new Response(JSON.stringify({
      model: "jev-1.13.0",
      answers: { case_support: { type: "choice", choice: "supports", probabilities: { supports: 0.7 }, confidence: 0.7 }, omits_relevant: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 800, output_tokens: 20 },
    })));
    const r = await review(explanationRequests(ex("Y12-original"))[0].req, { apiKey: "k", fetch: f });
    expect(r.answers).toEqual({ case_support: { choice: "supports", confidence: 0.7 }, omits_relevant: { noul: 0.8 } });
    expect(r.needsHuman).toBe(true);
  });
});
