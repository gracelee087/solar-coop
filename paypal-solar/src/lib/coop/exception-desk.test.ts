import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXCEPTION_CASES } from "./exception-cases";
import { loadExceptionRun, loadHoldoutRun, reviewException, ruleBaselineRun, saveExceptionRun } from "./exception-desk";

let runs: string;
beforeEach(() => {
  runs = mkdtempSync(path.join(os.tmpdir(), "coop-exc-"));
  saveExceptionRun(runs, ruleBaselineRun(EXCEPTION_CASES, new Date("2026-10-14T12:00:00Z")));
});
afterEach(() => rmSync(runs, { recursive: true, force: true }));
const id = () => loadExceptionRun(runs, "rules")!.runId;

describe("exception desk", () => {
  it("saves the rule baseline as rule results, separate from any agent run", () => {
    const r = loadExceptionRun(runs, "rules")!;
    expect(r.proposals.every((p) => p.source === "rule")).toBe(true);
    expect(r.proposals.find((p) => p.caseId === "X04")!.action).toBe("remind"); // rules never read the bank-transfer message
    expect(loadExceptionRun(runs, "agent")).toBeNull();
  });

  it("records a review without changing the proposal", () => {
    const before = loadExceptionRun(runs, "rules")!.proposals;
    const r = reviewException(runs, { source: "rules", runId: id(), caseId: "X04", by: "Sohee", agrees: false, comment: "Check the bank first." });
    expect(r.status).toBe(200);
    const after = loadExceptionRun(runs, "rules")!;
    expect(after.reviews.X04).toMatchObject({ by: "Sohee", agrees: false, comment: "Check the bank first." });
    expect(after.proposals).toEqual(before);
  });

  it("requires a name, a reason to disagree, and reviews each case once", () => {
    expect(reviewException(runs, { source: "rules", runId: id(), caseId: "X04", by: " ", agrees: true }).status).toBe(400);
    expect(reviewException(runs, { source: "rules", runId: id(), caseId: "X04", by: "S", agrees: false }).status).toBe(400);
    expect(reviewException(runs, { source: "rules", runId: id(), caseId: "X99", by: "S", agrees: true }).status).toBe(404);
    expect(reviewException(runs, { source: "agent", runId: id(), caseId: "X04", by: "S", agrees: true }).status).toBe(404);
    expect(reviewException(runs, { source: "rules", runId: id(), caseId: "X01", by: "S", agrees: true }).status).toBe(200);
    expect(reviewException(runs, { source: "rules", runId: id(), caseId: "X01", by: "S", agrees: true }).status).toBe(409);
  });

  it("refuses a review made on an earlier run, so it never lands on a changed proposal", () => {
    const shown = loadExceptionRun(runs, "rules")!; // the page shows X04 = remind
    expect(shown.proposals.find((p) => p.caseId === "X04")!.action).toBe("remind");
    const newer = ruleBaselineRun(EXCEPTION_CASES, new Date("2026-10-15T12:00:00Z"));
    newer.proposals = newer.proposals.map((p) => (p.caseId === "X04" ? { ...p, action: "escalate" as const } : p));
    saveExceptionRun(runs, newer);
    const r = reviewException(runs, { source: "rules", runId: shown.runId, caseId: "X04", by: "Sohee", agrees: true });
    expect(r).toMatchObject({ status: 409, body: { stale: true } });
    expect(loadExceptionRun(runs, "rules")!.reviews).toEqual({});
    expect(reviewException(runs, { source: "rules", runId: newer.runId, caseId: "X04", by: "Sohee", agrees: true }).status).toBe(200);
  });

  it("marks every run as synthetic evaluation cases", () => {
    expect(loadExceptionRun(runs, "rules")!.dataset).toBe("synthetic_cases");
  });
});

describe("held-out evaluation run", () => {
  it("loads the latest saved run read-only, with its scores, and cannot be reviewed", () => {
    expect(loadHoldoutRun(runs)).toBeNull();
    mkdirSync(path.join(runs, "coop-exceptions-eval"));
    const saved = (ranAt: string, action: string) => JSON.stringify({
      source: "agent", dataset: "synthetic_holdout", model: "m", ranAt,
      agent: { correct: 12, total: 12 }, rules: { correct: 8, total: 12 },
      views: [], proposals: [{ caseId: "Y11", action, reason: "r", evidence: [], unverified: [], source: "agent" }], problems: [],
    });
    writeFileSync(path.join(runs, "coop-exceptions-eval", "holdout-2026-10-14T10-00-00-000Z.json"), saved("2026-10-14T10:00:00Z", "remind"));
    writeFileSync(path.join(runs, "coop-exceptions-eval", "holdout-2026-10-14T15-05-04-342Z.json"), saved("2026-10-14T15:05:04Z", "escalate"));
    const r = loadHoldoutRun(runs)!;
    expect(r).toMatchObject({ readOnly: true, dataset: "synthetic_holdout", savedAt: "2026-10-14T15:05:04Z", score: { agent: { correct: 12 }, rules: { correct: 8 } } });
    expect(r.proposals[0].action).toBe("escalate");
    expect(reviewException(runs, { source: "holdout", runId: r.runId, caseId: "Y11", by: "S", agrees: true }).status).toBe(400);
  });
});
