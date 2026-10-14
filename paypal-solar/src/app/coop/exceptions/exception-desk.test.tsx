import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXCEPTION_CASES } from "../../../lib/coop/exception-cases";
import { ruleBaselineRun, type ExceptionRun } from "../../../lib/coop/exception-desk";
import { caseView } from "../../../lib/coop/exceptions";
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
});
