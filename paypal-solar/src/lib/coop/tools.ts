import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { aggregateCoopMonth } from "./allocation";
import type { PaymentLedger } from "./ledger";
import { settleMonth } from "./statements";
import type { CoopGroup, MeterInterval, Settlement } from "./types";

export interface CoopToolContext {
  group: CoopGroup;
  ledger: PaymentLedger;
  /** Validated meter intervals for a period (e.g. parsed from the operator's CSV). */
  loadMonth: (period: string) => MeterInterval[];
}

const period = z.string().regex(/^\d{4}-\d{2}$/).describe("Billing period, YYYY-MM");
const draftId = z.string().min(1).max(80);

/**
 * Agent tools for the operator workflow. The model passes only ids and periods: every amount comes from the
 * settlement computed in code, approval is a human step outside these tools, and execute_payment runs only drafts a
 * human approved. Refund amounts are checked against the bill and the hard limits, and still need approval.
 */
export function coopTools(ctx: CoopToolContext): ToolSet {
  const settlements = new Map<string, Settlement>();
  const settlementFor = (p: string) => {
    const s = settlements.get(p);
    if (!s) throw new Error(`Run calculate_settlement for ${p} first`);
    return s;
  };

  return {
    calculate_settlement: tool({
      description: "Allocate the month's 15-minute meter data and compute each consumer's bill and producer's payout (amounts in cents).",
      inputSchema: z.object({ period }),
      execute: async ({ period }) => {
        const s = settleMonth(ctx.group, aggregateCoopMonth(ctx.group, period, ctx.loadMonth(period)));
        settlements.set(period, s);
        return s;
      },
    }),
    draft_invoice: tool({
      description: "Create a bill draft for one consumer from the computed settlement. Does not send anything.",
      inputSchema: z.object({ period, participantId: z.string().min(1).max(20) }),
      execute: async ({ period, participantId }) => {
        const st = settlementFor(period).consumers.find((c) => c.participantId === participantId);
        if (!st) throw new Error(`${participantId} is not a consumer in this settlement`);
        if (st.amountCents === 0) return { skipped: true, reason: "nothing to bill" };
        return ctx.ledger.draft({ kind: "bill", participantId, period, statementId: st.statementId, amountCents: st.amountCents });
      },
    }),
    draft_payout: tool({
      description: "Create a payout draft for one producer from the computed settlement. Does not send anything.",
      inputSchema: z.object({ period, participantId: z.string().min(1).max(20) }),
      execute: async ({ period, participantId }) => {
        const st = settlementFor(period).producers.find((p) => p.participantId === participantId);
        if (!st) throw new Error(`${participantId} is not a producer in this settlement`);
        if (st.amountCents === 0) return { skipped: true, reason: "nothing to pay out" };
        return ctx.ledger.draft({ kind: "payout", participantId, period, statementId: st.statementId, amountCents: st.amountCents });
      },
    }),
    request_approval: tool({
      description: "Put a draft in the human approval queue. Approval itself is done by a person, not by this tool.",
      inputSchema: z.object({ draftId }),
      execute: async ({ draftId }) => ctx.ledger.requestApproval(draftId),
    }),
    execute_payment: tool({
      description: "Execute a draft a human has approved. Refused for any other status or above the hard limits. Never retry a failure.",
      inputSchema: z.object({ draftId }),
      execute: async ({ draftId }) => ctx.ledger.execute(draftId),
    }),
    refund: tool({
      description: "Create a refund draft for an executed bill (needs approval and execute_payment afterwards).",
      inputSchema: z.object({
        billDraftId: draftId,
        amountCents: z.number().int().positive(),
        captureId: z.string().min(1).max(80),
      }),
      execute: async ({ billDraftId, amountCents, captureId }) => ctx.ledger.draftRefund(billDraftId, amountCents, captureId),
    }),
  };
}
