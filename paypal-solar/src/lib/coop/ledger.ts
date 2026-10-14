import { berlinDay, checkDailyTotal, checkPaymentAmount, paymentMemo } from "./limits";
import type { PaymentKind, PaymentRail, RailResult } from "./rail";
import type { Reconciliation } from "./reconcile";
import type { Participant } from "./types";

export type DraftStatus = "draft" | "pending_approval" | "approved" | "rejected" | "executing" | "executed" | "failed";

export interface PaymentDraft {
  id: string;
  kind: PaymentKind;
  participantId: string;
  period: string;
  statementId: string;
  amountCents: number;
  currency: "EUR";
  memo: string;
  status: DraftStatus;
  createdAt: string;
  /** Refunds only: the executed bill draft being refunded and its PayPal capture. */
  refundOf?: { draftId: string; captureId: string };
  approval?: { by: string; at: string };
  rejection?: { by: string; at: string; reason: string };
  executedAt?: string;
  result?: RailResult;
  error?: string;
  /** Latest comparison of what PayPal reports with the settlement amount. */
  reconciliation?: Reconciliation;
}

export interface DraftInput {
  kind: "bill" | "payout";
  participantId: string;
  period: string;
  statementId: string;
  amountCents: number;
}

/** Amount executed on a Berlin calendar day. A failed execution may still have reached the provider, so it counts too. */
export function executedCentsOn(drafts: PaymentDraft[], day: string): number {
  return drafts
    .filter((x) => x.executedAt && x.status !== "approved" && berlinDay(new Date(x.executedAt)) === day)
    .reduce((s, x) => s + x.amountCents, 0);
}

/**
 * Payment ledger with a two-step safety flow: draft → human approval → execution. Only `approve` / `reject` move a
 * draft past approval, and they are never exposed as agent tools. Limits are checked when drafting and again right
 * before execution. A failed execution is not retried automatically: the outcome at the provider may be unknown.
 */
export class PaymentLedger {
  private drafts = new Map<string, PaymentDraft>();
  private participants: Map<string, Participant>;

  constructor(
    participants: Participant[],
    private rail: PaymentRail,
    private now: () => Date = () => new Date(),
  ) {
    this.participants = new Map(participants.map((p) => [p.id, p]));
  }

  /**
   * Rebuilds a ledger from saved drafts. A draft saved while `executing` has an unknown outcome at the provider, so
   * it comes back as `failed` and is never executed again automatically.
   */
  static restore(participants: Participant[], rail: PaymentRail, saved: PaymentDraft[], now?: () => Date): PaymentLedger {
    const l = new PaymentLedger(participants, rail, now);
    for (const d of saved) {
      if (l.drafts.has(d.id)) throw new Error(`Duplicate saved draft ${d.id}`);
      if (!l.participants.has(d.participantId)) throw new Error(`Saved draft ${d.id} has an unknown participant`);
      const copy = { ...d };
      if (copy.status === "executing") {
        copy.status = "failed";
        copy.error = "interrupted before the result was recorded; check the provider before any new attempt";
      }
      l.drafts.set(copy.id, copy);
    }
    return l;
  }

  list(): PaymentDraft[] {
    return [...this.drafts.values()].map((d) => ({ ...d }));
  }

  get(id: string): PaymentDraft {
    const d = this.drafts.get(id);
    if (!d) throw new Error(`Unknown draft ${id}`);
    return { ...d };
  }

  /** Creates a bill or payout draft. Drafting the same statement again returns the existing draft (no duplicate). */
  draft(input: DraftInput): PaymentDraft {
    const p = this.participants.get(input.participantId);
    if (!p) throw new Error(`Unknown participant ${input.participantId}`);
    if (input.kind === "bill" && p.role !== "consumer") throw new Error(`${p.id} is not a consumer`);
    if (input.kind === "payout" && p.role !== "producer") throw new Error(`${p.id} is not a producer`);
    const id = `${input.kind}-${input.statementId}`;
    const existing = this.drafts.get(id);
    if (existing && existing.status !== "rejected") {
      if (existing.amountCents !== input.amountCents) throw new Error(`Draft ${id} exists with a different amount`);
      return { ...existing };
    }
    const problem = checkPaymentAmount(input.amountCents);
    if (problem) throw new Error(`Draft refused: ${problem}`);
    const d: PaymentDraft = {
      id,
      ...input,
      currency: "EUR",
      memo: paymentMemo(input.kind, input.period, input.statementId),
      status: "draft",
      createdAt: this.now().toISOString(),
    };
    this.drafts.set(id, d);
    return { ...d };
  }

  /** Drafts a (partial) refund of an executed bill; all refunds of a bill together never exceed its amount. */
  draftRefund(billDraftId: string, amountCents: number, captureId: string): PaymentDraft {
    const bill = this.drafts.get(billDraftId);
    if (!bill || bill.kind !== "bill") throw new Error(`Unknown bill draft ${billDraftId}`);
    if (bill.status !== "executed") throw new Error(`Bill ${billDraftId} was not executed`);
    if (!captureId.trim()) throw new Error("Refund needs the PayPal capture id");
    const problem = checkPaymentAmount(amountCents);
    if (problem) throw new Error(`Refund refused: ${problem}`);
    // Ids count every refund of the bill, rejected ones included, so a new refund never reuses an existing id.
    const allRefunds = [...this.drafts.values()].filter((d) => d.refundOf?.draftId === billDraftId);
    const already = allRefunds.filter((d) => d.status !== "rejected").reduce((s, d) => s + d.amountCents, 0);
    if (already + amountCents > bill.amountCents) {
      throw new Error(`Refund refused: ${already + amountCents} cents would exceed the bill of ${bill.amountCents} cents`);
    }
    const refundId = `refund-${bill.statementId}-${allRefunds.length + 1}`;
    if (this.drafts.has(refundId)) throw new Error(`Refund id ${refundId} already exists`);
    const d: PaymentDraft = {
      id: refundId,
      kind: "refund",
      participantId: bill.participantId,
      period: bill.period,
      statementId: bill.statementId,
      amountCents,
      currency: "EUR",
      memo: paymentMemo("refund", bill.period, bill.statementId),
      status: "draft",
      createdAt: this.now().toISOString(),
      refundOf: { draftId: billDraftId, captureId },
    };
    this.drafts.set(d.id, d);
    return { ...d };
  }

  requestApproval(id: string): PaymentDraft {
    const d = this.mustBe(id, ["draft", "pending_approval"]);
    d.status = "pending_approval";
    return { ...d };
  }

  /** Human decision. Not an agent tool. */
  approve(id: string, by: string): PaymentDraft {
    if (!by.trim()) throw new Error("Approver is required");
    const d = this.mustBe(id, ["pending_approval"]);
    d.status = "approved";
    d.approval = { by, at: this.now().toISOString() };
    return { ...d };
  }

  /** Human decision. Not an agent tool. */
  reject(id: string, by: string, reason: string): PaymentDraft {
    if (!by.trim()) throw new Error("Approver is required");
    const d = this.mustBe(id, ["draft", "pending_approval", "approved"]);
    d.status = "rejected";
    d.rejection = { by, at: this.now().toISOString(), reason };
    return { ...d };
  }

  /**
   * `onExecuting` receives all drafts right after this one is marked `executing` and before the provider is called,
   * so a caller can save that state first: after a crash the draft then comes back as failed, never as approved.
   */
  async execute(id: string, onExecuting?: (drafts: PaymentDraft[]) => void, executedElsewhereTodayCents = 0): Promise<PaymentDraft> {
    const d = this.mustBe(id, ["approved"]);
    const at = this.now();
    // The daily limit covers the operator's whole account: the caller adds what other months' ledgers executed today.
    const today = executedCentsOn([...this.drafts.values()], berlinDay(at)) + executedElsewhereTodayCents;
    const problem = checkPaymentAmount(d.amountCents) ?? checkDailyTotal(today, d.amountCents);
    if (problem) throw new Error(`Execution refused: ${problem}`);
    const p = this.participants.get(d.participantId)!;
    d.status = "executing"; // set before awaiting, so a second execute of the same draft is refused
    d.executedAt = at.toISOString();
    try {
      onExecuting?.(this.list());
      d.result = await this.rail.execute({
        draftId: d.id,
        kind: d.kind,
        recipient: { name: p.name, email: p.email },
        amountCents: d.amountCents,
        currency: d.currency,
        memo: d.memo,
        period: d.period,
        statementId: d.statementId,
        captureId: d.refundOf?.captureId,
      });
      d.status = "executed";
    } catch (e) {
      d.status = "failed";
      d.error = e instanceof Error ? e.message : String(e);
    }
    return { ...d };
  }

  /** Stores the latest reconciliation of an executed draft. It never changes the amount or status. */
  recordReconciliation(id: string, rec: Reconciliation): PaymentDraft {
    const d = this.mustBe(id, ["executed"]);
    d.reconciliation = rec;
    return { ...d };
  }

  private mustBe(id: string, allowed: DraftStatus[]): PaymentDraft {
    const d = this.drafts.get(id);
    if (!d) throw new Error(`Unknown draft ${id}`);
    if (!allowed.includes(d.status)) throw new Error(`Draft ${id} is ${d.status}, expected ${allowed.join(" or ")}`);
    return d;
  }
}
