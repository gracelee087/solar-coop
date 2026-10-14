import path from "node:path";
import { PaymentLedger, type DraftStatus } from "./ledger";
import type { PaymentRail } from "./rail";
import { sampleCoop } from "./sample-group";
import { loadState, updateState, type CoopState } from "./state";

/** agent = the real run (executable from the CLI); replay = a copy of the real run before approval, never executed. */
export type DeskSource = "agent" | "replay" | "rehearsal";

export interface DeskItem {
  draftId: string;
  kind: "bill" | "payout";
  name: string;
  participantId: string;
  amountEur: string;
  kWh: string;
  totalKWh: string;
  sharePct: string;
  priceCt: string;
  status: DraftStatus;
  summary: string;
  summarySource: "agent" | "default";
  noteRejected?: string;
  flags: { code: string; message: string }[];
  decision?: { by: string; at: string; reason?: string };
  /** PayPal id of the sent invoice or payout batch. */
  externalId?: string;
  reconciliation?: { status: "matched" | "pending" | "mismatch"; reason: string; checkedAt: string; externalStatus: string };
}

export interface DeskView {
  period: string;
  source: DeskSource;
  model: string | null;
  savedAt: string;
  problems: string[];
  totals: { billedCents: number; payoutCents: number; operatorCents: number };
  counts: Record<"pending" | "approved" | "rejected" | "executed" | "matched", number>;
  items: DeskItem[];
}

export const dirFor = (runsDir: string, source: DeskSource) =>
  path.join(runsDir, source === "agent" ? "coop" : source === "replay" ? "coop-replay" : "coop-rehearsal");
const cents = (eur: string) => Math.round(Number(eur) * 100);

const noExecution: PaymentRail = {
  name: "none",
  execute: async () => {
    throw new Error("Payment execution is not part of the approval desk");
  },
};

export function toDeskView(s: CoopState, source: DeskSource): DeskView {
  const items: DeskItem[] = s.queue.map((q) => {
    const d = s.drafts.find((x) => x.id === q.facts.draftId);
    if (!d) throw new Error(`Queue entry ${q.facts.draftId} has no draft`);
    const decision = d.approval ?? (d.rejection ? { by: d.rejection.by, at: d.rejection.at, reason: d.rejection.reason } : undefined);
    return {
      draftId: d.id, kind: q.facts.kind, name: q.facts.name, participantId: q.facts.participantId,
      amountEur: q.facts.amountEur, kWh: q.facts.kWh, totalKWh: q.facts.totalKWh, sharePct: q.facts.sharePct, priceCt: q.facts.priceCt,
      status: d.status, summary: q.summary, summarySource: q.summarySource,
      ...(q.noteRejected ? { noteRejected: q.noteRejected } : {}),
      flags: q.facts.flags, ...(decision ? { decision } : {}),
      ...(d.result ? { externalId: d.result.externalId } : {}),
      ...(d.reconciliation
        ? { reconciliation: { status: d.reconciliation.status, reason: d.reconciliation.reason, checkedAt: d.reconciliation.checkedAt, externalStatus: d.reconciliation.observed.externalStatus } }
        : {}),
    };
  });
  const sum = (kind: "bill" | "payout") => items.filter((i) => i.kind === kind).reduce((t, i) => t + cents(i.amountEur), 0);
  const billedCents = sum("bill");
  const payoutCents = sum("payout");
  return {
    period: s.period, source, model: s.model, savedAt: s.savedAt, problems: s.problems,
    totals: { billedCents, payoutCents, operatorCents: billedCents - payoutCents },
    counts: {
      pending: items.filter((i) => i.status === "pending_approval").length,
      approved: items.filter((i) => i.status === "approved").length,
      rejected: items.filter((i) => i.status === "rejected").length,
      executed: items.filter((i) => i.status === "executed").length,
      matched: items.filter((i) => i.reconciliation?.status === "matched").length,
    },
    items,
  };
}

/**
 * The requested source, or by default the real agent run if one was saved for the period, otherwise the scripted
 * rehearsal; null if none exists.
 */
export function loadDesk(runsDir: string, period: string, only?: DeskSource): DeskView | null {
  for (const source of only ? [only] : (["agent", "rehearsal"] as const)) {
    const s = loadState(dirFor(runsDir, source), period);
    if (s) return toDeskView(s, source);
  }
  return null;
}

export interface DecisionBody {
  period: string;
  source: DeskSource;
  draftId: string;
  decision: "approve" | "reject";
  by: string;
  reason?: string;
}

/** Validates a request body; returns the parsed body or an error message. */
export function parseDecision(body: unknown): DecisionBody | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Expected a JSON object";
  const b = body as Record<string, unknown>;
  const str = (k: string, max: number) => typeof b[k] === "string" && (b[k] as string).trim() !== "" && (b[k] as string).length <= max;
  if (!str("period", 7) || !/^\d{4}-\d{2}$/.test(b.period as string)) return "Invalid period";
  if (b.source !== "agent" && b.source !== "replay" && b.source !== "rehearsal") return "Invalid source";
  if (!str("draftId", 80)) return "Invalid draft id";
  if (b.decision !== "approve" && b.decision !== "reject") return "Decision must be approve or reject";
  if (!str("by", 60)) return "Approver name is required";
  if (b.decision === "reject" && !str("reason", 300)) return "A reason is required to reject";
  return {
    period: b.period as string, source: b.source, draftId: b.draftId as string, decision: b.decision,
    by: (b.by as string).trim(), ...(b.decision === "reject" ? { reason: (b.reason as string).trim() } : {}),
  };
}

/** Applies one human decision to the saved state. Never executes a payment. */
export function decide(runsDir: string, body: unknown): { status: number; body: unknown } {
  const parsed = parseDecision(body);
  if (typeof parsed === "string") return { status: 400, body: { error: parsed } };
  const dir = dirFor(runsDir, parsed.source);
  const state = loadState(dir, parsed.period);
  if (!state) return { status: 404, body: { error: `No saved run for ${parsed.period}` } };
  if (!state.queue.some((q) => q.facts.draftId === parsed.draftId)) return { status: 404, body: { error: "Unknown draft" } };
  let next: CoopState;
  try {
    // Applied to the latest saved drafts under the state lock, so a concurrent CLI save is never overwritten.
    next = updateState(dir, parsed.period, (cur) => {
      const ledger = PaymentLedger.restore(sampleCoop.participants, noExecution, cur!.drafts);
      if (parsed.decision === "approve") ledger.approve(parsed.draftId, parsed.by);
      else ledger.reject(parsed.draftId, parsed.by, parsed.reason!);
      return { ...cur!, savedAt: new Date().toISOString(), drafts: ledger.list() };
    });
  } catch (e) {
    return { status: 409, body: { error: (e as Error).message } };
  }
  return { status: 200, body: toDeskView(next, parsed.source) };
}
