import sandbox from "../../data/submission/sandbox-june.json";
import holdout from "../../../experiments/jev-grounding/fixtures/gemini-y-run-2026-10-14.json";
import type { CoopState } from "./state";
import type { ExceptionRun } from "./exception-desk";
import { makeView } from "./workbench";

/** Bundled immutable observations. Never copied into the executable runs/ ledger. */
export function submissionWorkbench() {
  return makeView(structuredClone(sandbox) as CoopState, "agent", {});
}

export function submissionHoldout(): ExceptionRun {
  return {
    runId: "submission-holdout-2026-10-14",
    source: "agent",
    dataset: "synthetic_holdout",
    savedAt: holdout.ranAt,
    model: holdout.model,
    views: structuredClone(holdout.views) as ExceptionRun["views"],
    proposals: structuredClone(holdout.proposals) as ExceptionRun["proposals"],
    problems: holdout.problems,
    usage: holdout.usage,
    reviews: {},
    readOnly: true,
    score: { agent: holdout.agent, rules: holdout.rules },
  };
}
