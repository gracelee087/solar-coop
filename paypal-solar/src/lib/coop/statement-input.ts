import type { WorkItem } from "./workbench-types";

/** Exactly what the investigation agent's get_statement tool returns; also the input a saved run is matched against. */
export const statementToolInput = (item: WorkItem) => ({ statementId: item.statementId, kind: item.kind, topic: item.work.topic, evidence: item.evidence });
