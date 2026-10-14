import type { DeskItem, DeskSource, DeskView } from "./desk";

export interface Evidence { id: string; kind: "fact" | "claim"; text: string }
export interface Investigation {
  reason: string;
  evidence: string[];
  unverified: string[];
  checks: string[];
  replyDraft: string;
}
export interface WorkCase {
  messages: { id: string; text: string; by: string; at: string }[];
  status: "open" | "awaiting_evidence" | "resolved";
  proposal?: Investigation & { source: "template" | "agent"; model?: string; basis: string; at: string };
  history: { event: string; by: string; at: string; detail: string }[];
}
export interface WorkItem extends DeskItem {
  statementId: string;
  version: string;
  basis: string;
  evidence: Evidence[];
  work: WorkCase;
  proposalStale: boolean;
}
export interface WorkbenchView {
  desk: DeskView;
  items: WorkItem[];
  closingNotes: string[];
  counts: { review: number; matched: number; unmatched: number; openCases: number; readyToClose: boolean };
}
export interface WorkTarget { period: string; source: DeskSource; draftId: string }
