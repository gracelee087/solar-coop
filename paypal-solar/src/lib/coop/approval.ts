import { MAX_PAYMENT_CENTS } from "./limits";
import type { PaymentDraft } from "./ledger";
import type { CoopGroup, CoopMonth, Settlement } from "./types";

export type FlagCode = "no_consumption" | "nothing_received" | "near_payment_limit" | "no_feed_in" | "no_shared_sales";

export interface Flag {
  code: FlagCode;
  message: string;
}

/** Facts the operator needs to approve one draft, all computed in code. */
export interface ApprovalFacts {
  draftId: string;
  kind: "bill" | "payout";
  participantId: string;
  name: string;
  period: string;
  /** Received (bill) or credited (payout) energy, kWh with one decimal. */
  kWh: string;
  /** Consumption (bill) or feed-in (payout) in the month, kWh with one decimal. */
  totalKWh: string;
  /** kWh as a whole percentage of totalKWh. */
  sharePct: string;
  priceCt: string;
  amountEur: string;
  flags: Flag[];
}

export interface QueueEntry {
  facts: ApprovalFacts;
  summary: string;
  summarySource: "agent" | "default";
  /** Why an agent note was not used, if one was rejected. */
  noteRejected?: string;
}

const kwh = (wh: number) => (wh / 1000).toFixed(1);
const pct = (part: number, whole: number) => (whole > 0 ? String(Math.round((100 * part) / whole)) : "0");

/** Anomaly flags are decided by code; the agent only puts them into words. */
export function flagsFor(kind: "bill" | "payout", energyWh: number, totalWh: number, amountCents: number): Flag[] {
  const flags: Flag[] = [];
  if (kind === "bill" && totalWh === 0) flags.push({ code: "no_consumption", message: "No consumption metered this month" });
  if (kind === "bill" && totalWh > 0 && energyWh === 0) flags.push({ code: "nothing_received", message: "Consumed, but received no shared energy" });
  if (kind === "payout" && totalWh === 0) flags.push({ code: "no_feed_in", message: "No feed-in metered this month" });
  if (kind === "payout" && totalWh > 0 && energyWh === 0) flags.push({ code: "no_shared_sales", message: "Fed in, but none of it was shared" });
  if (amountCents > 0.8 * MAX_PAYMENT_CENTS) flags.push({ code: "near_payment_limit", message: "Amount above 80 % of the 500 € per-payment limit" });
  return flags;
}

export function approvalFacts(g: CoopGroup, s: Settlement, m: CoopMonth, d: PaymentDraft): ApprovalFacts {
  if (d.kind === "refund") throw new Error("Refund drafts are not part of the monthly approval queue");
  const name = g.participants.find((p) => p.id === d.participantId)?.name ?? d.participantId;
  if (d.kind === "bill") {
    const st = s.consumers.find((c) => c.statementId === d.statementId);
    if (!st || st.amountCents !== d.amountCents) throw new Error(`Draft ${d.id} does not match the settlement`);
    const total = m.consumptionWh[d.participantId];
    return {
      draftId: d.id, kind: "bill", participantId: d.participantId, name, period: d.period,
      kWh: kwh(st.receivedWh), totalKWh: kwh(total), sharePct: pct(st.receivedWh, total),
      priceCt: st.priceCt.toFixed(2), amountEur: (st.amountCents / 100).toFixed(2),
      flags: flagsFor("bill", st.receivedWh, total, st.amountCents),
    };
  }
  const st = s.producers.find((p) => p.statementId === d.statementId);
  if (!st || st.amountCents !== d.amountCents) throw new Error(`Draft ${d.id} does not match the settlement`);
  const total = m.feedInWh[d.participantId];
  return {
    draftId: d.id, kind: "payout", participantId: d.participantId, name, period: d.period,
    kWh: kwh(st.soldWh), totalKWh: kwh(total), sharePct: pct(st.soldWh, total),
    priceCt: st.payoutCt.toFixed(2), amountEur: (st.amountCents / 100).toFixed(2),
    flags: flagsFor("payout", st.soldWh, total, st.amountCents),
  };
}

/** Summary used whenever the agent's note is missing or fails the check. */
export function defaultSummary(f: ApprovalFacts): string {
  const what =
    f.kind === "bill"
      ? `Bill to ${f.name} for ${f.period}: ${f.kWh} kWh shared energy (${f.sharePct} % of ${f.totalKWh} kWh used) at ${f.priceCt} ct = ${f.amountEur} €.`
      : `Payout to ${f.name} for ${f.period}: ${f.kWh} kWh shared (${f.sharePct} % of ${f.totalKWh} kWh fed in) at ${f.priceCt} ct = ${f.amountEur} €.`;
  return `${what} ${f.flags.length ? `Check: ${f.flags.map((x) => x.message).join("; ")}.` : "No flags."}`;
}

/**
 * Checks an agent note against the facts. Every number must carry its unit and equal the fact with that unit
 * (amount with €, energy with kWh, price with ct, share with %), so two valid numbers cannot be swapped; any other
 * digit is rejected. The period and the participant's id and name are the only other places digits may appear.
 */
export function checkNote(f: ApprovalFacts, note: string): string | null {
  if (!note.trim()) return "empty note";
  if (note.length > 600) return "note longer than 600 characters";
  const allowed: Record<string, string[]> = {
    "€": [f.amountEur],
    kWh: [f.kWh, f.totalKWh],
    ct: [f.priceCt, String(Number(f.priceCt))],
    "%": [f.sharePct],
  };
  let rest = note.split(f.period).join(" ").split(f.name).join(" ").split(f.participantId).join(" ");
  const unitPattern = /(\d+(?:[.,]\d+)?)\s*(€|EUR|kWh|ct|%)/g;
  for (const [, num, unitRaw] of rest.matchAll(unitPattern)) {
    const unit = unitRaw === "EUR" ? "€" : unitRaw;
    if (!allowed[unit].includes(num.replace(",", "."))) return `number ${num} ${unitRaw} does not match the facts`;
  }
  rest = rest.replace(unitPattern, " ");
  if (/\d/.test(rest)) return "number without a matching unit";
  return null;
}
