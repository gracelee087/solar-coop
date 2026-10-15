import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXCEPTION_CASES } from "../../../lib/coop/exception-cases";
import { ruleBaselineRun, type ExceptionRun } from "../../../lib/coop/exception-desk";
import { caseView } from "../../../lib/coop/exceptions";
import { submissionHoldout } from "../../../lib/coop/submission-evidence";
import ExceptionDesk from "./exception-desk";

const at = new Date("2026-10-14T12:00:00Z");
const html = (run: ExceptionRun) => renderToStaticMarkup(<ExceptionDesk initial={run} />);

describe("exception desk page", () => {
  it("labels rule results as not AI and never as an agent proposal", () => {
    const out = html(ruleBaselineRun(EXCEPTION_CASES, at));
    expect(out).toContain("Fixed rules, not a model run");
    expect(out).toContain("Fixed rule result — not AI, messages not read");
    expect(out).not.toContain("AI agent proposal");
  });

  it("separates facts, unverified claims and the agent proposal, with tags that show the source text", () => {
    const x04 = EXCEPTION_CASES.find((x) => x.id === "X04")!;
    const run: ExceptionRun = {
      runId: "run-1", dataset: "synthetic_cases", source: "agent", savedAt: at.toISOString(), model: "test-model", problems: [], reviews: {},
      views: [caseView(x04)],
      proposals: [{
        caseId: "X04", action: "escalate", source: "agent",
        reason: "PayPal shows the bill unpaid; Haus 7 says it paid by bank transfer on 14 July.",
        evidence: ["Payment confirmed by PayPal: no", "N1"],
        unverified: ["Bank transfer of 14 July not yet found on the bank statement"],
      }],
    };
    const out = html(run);
    expect(out).toContain("Synthetic evaluation cases.");
    expect(out).toContain("Facts · synthetic case, written by code (not fetched from PayPal)");
    expect(out).not.toContain("Facts · from PayPal and the ledger");
    expect(out).toContain("Payment confirmed by PayPal: no");
    expect(out).toContain("Bank account check: not connected");
    expect(out).toContain("Messages · unverified claims");
    expect(out).toContain("Customer message N1 · unverified");
    expect(out).toContain("Claim in a message. Not verified");
    expect(out).toContain("Still to confirm by a person");
    expect(out).toContain("It does not check whether the reasoning is correct.");
  });

  it("states that a review takes no action", () => {
    const run = ruleBaselineRun(EXCEPTION_CASES.slice(0, 1), at);
    run.reviews.X01 = { by: "Sohee", at: at.toISOString(), agrees: true };
    expect(html(run)).toContain("No action taken:");
  });

  it("shows a held-out run read-only, labelled as a saved run on synthetic cases, without review controls", () => {
    const run: ExceptionRun = {
      ...ruleBaselineRun(EXCEPTION_CASES.slice(0, 1), at),
      source: "agent", dataset: "synthetic_holdout", readOnly: true, model: "m",
      score: { agent: { correct: 12, total: 12 }, rules: { correct: 8, total: 12 } },
    };
    const out = html(run);
    expect(out).toContain("Synthetic evaluation cases.");
    expect(out).toContain("Team-authored synthetic cases, read-only.");
    expect(out).not.toContain("Held-out");
    expect(out).toContain("12/12");
    expect(out).toContain("the fixed rules in 8/12");
    expect(out).not.toContain("Agree");
    expect(out).not.toContain("Your name");
  });

  it("shows the saved per-case misses, the saved AI agent output and a code checklist for the selected case", () => {
    const out = html(submissionHoldout());
    expect(out).toContain("Per case · matched the frozen answer");
    expect(out).toContain("Differ: AI agent none · fixed rules Y01, Y04, Y07, Y11.");
    expect(out).toContain("AI guide · Saved AI agent output");
    expect(out).toContain("Checklist · computed by code, not AI");
    expect(out).toContain("Y11");
    expect(out).not.toContain("Agree");
  });

  it("says when a run has no per-case comparison", () => {
    expect(html(ruleBaselineRun(EXCEPTION_CASES, at))).toContain("No per-case comparison with frozen answers in this saved run");
  });

  it("keeps secondary detail in collapsed sections without dropping any caveat", () => {
    const out = html(submissionHoldout());
    const summaries = out.split("<summary>").slice(1).map((seg) => seg.split("</summary>")[0]);
    for (const label of ["One saved run · not an independent benchmark", "Checklist · computed by code, not AI", "Which cases differ", "Colour key", "Based on (2)", "Still to confirm by a person (1)"]) {
      expect(summaries.some((s) => s.includes(label))).toBe(true);
    }
    expect(out).not.toMatch(/<details[^>]* open/);
    expect(out).toContain("Not an independent accuracy measure.");
    expect(out).toContain("It does not check whether the reasoning is correct.");
  });
});
