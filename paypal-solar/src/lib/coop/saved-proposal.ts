import { createHash } from "node:crypto";
import run from "../../../experiments/h07-dispute/run-2026-10-15.json";
import { statementToolInput } from "./statement-input";
import type { Investigation, WorkItem } from "./workbench-types";

/** The one recorded real AI agent run (experiments/h07-dispute). Shown only for exactly the input it saw. */
export const SAVED_RUN = { draftId: "bill-ST-202606-H07", period: "2026-06", model: run.model, ranAt: run.ranAt, inputSha256: run.inputSha256 };

const inputSha = (item: WorkItem) => createHash("sha256").update(JSON.stringify(statementToolInput(item), null, 2) + "\n").digest("hex");

/**
 * "match": the case is exactly the recorded input, so the saved proposal may be shown;
 * "differs": same statement, different input (for example no evidence yet, or other text): the saved proposal must not be used;
 * null: the recorded run does not concern this statement.
 */
export function savedRunStatus(item: WorkItem, period: string): "match" | "differs" | null {
  if (item.draftId !== SAVED_RUN.draftId || period !== SAVED_RUN.period || !run.accepted || !run.proposal) return null;
  return inputSha(item) === SAVED_RUN.inputSha256 ? "match" : "differs";
}

export function savedProposal(): Investigation {
  return structuredClone(run.proposal) as Investigation;
}
