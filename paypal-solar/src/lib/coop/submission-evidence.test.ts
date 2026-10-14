import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { submissionHoldout, submissionWorkbench } from "./submission-evidence";
import { HOLDOUT_CASES, HOLDOUT_EXPECTED } from "./exception-holdout";
import { ruleAction, scoreAccepted } from "./exception-rules";
import { aggregateCoopMonth } from "./allocation";
import { parseMeterCsv } from "./meter-csv";
import { sampleCoop } from "./sample-group";
import { settleMonth } from "./statements";
import { decide, loadDesk } from "./desk";

it("recalculates the bundled sandbox amounts from the submitted meter CSV", () => {
  const csv = readFileSync(
    path.join(__dirname, "../../data/coop-meter-2026-06.csv"),
    "utf8",
  );
  const month = parseMeterCsv(sampleCoop, "2026-06", csv);
  const settlement = settleMonth(
    sampleCoop,
    aggregateCoopMonth(sampleCoop, "2026-06", month),
  );
  const view = submissionWorkbench();
  for (const statement of [...settlement.consumers, ...settlement.producers]) {
    const item = view.items.find(
      (i) => i.statementId === statement.statementId,
    )!;
    expect(Math.round(Number(item.amountEur) * 100)).toBe(
      statement.amountCents,
    );
  }
  expect(view.counts.matched).toBe(10);
  expect(view.desk.totals).toEqual({
    billedCents: 10238,
    payoutCents: 9450,
    operatorCents: 788,
  });
});

it("re-scores the archived model outputs without a model call", () => {
  const run = submissionHoldout();
  expect(run.readOnly).toBe(true);
  expect(run.views).toHaveLength(12);
  const actual = scoreAccepted(
    HOLDOUT_CASES,
    HOLDOUT_EXPECTED,
    (c) => run.proposals.find((p) => p.caseId === c.id)!.action,
  );
  expect(actual.correct).toBe(run.score!.agent.correct);
  expect(
    scoreAccepted(HOLDOUT_CASES, HOLDOUT_EXPECTED, ruleAction).correct,
  ).toBe(run.score!.rules.correct);
});

it("does not turn bundled evidence into an executable or approvable ledger", () => {
  const runs = mkdtempSync(path.join(os.tmpdir(), "submission-evidence-"));
  try {
    const before = submissionWorkbench();
    expect(loadDesk(runs, "2026-06")).toBeNull();
    expect(
      decide(runs, {
        period: "2026-06",
        source: "agent",
        draftId: before.items[0].draftId,
        decision: "approve",
        by: "Judge",
      }).status,
    ).toBe(404);
    before.items[0].work.messages.push({
      id: "N1",
      by: "Judge",
      at: new Date().toISOString(),
      text: "Test",
    });
    expect(submissionWorkbench().items[0].work.messages).toEqual([]);
  } finally {
    rmSync(runs, { recursive: true, force: true });
  }
});
