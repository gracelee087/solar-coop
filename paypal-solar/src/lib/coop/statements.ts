import { consumersOf, producersOf, validateCoopGroup } from "./allocation";
import type { CoopGroup, CoopMonth, Settlement } from "./types";

/** Whole cents for `whValue` Wh at `ct` per kWh (1 kWh × 1 ct = 1 cent). */
export const centsFor = (whValue: number, ct: number) => Math.round((whValue * ct) / 1000);

/** One id per period and participant, so a re-run finds the same statement instead of billing twice. */
export const statementId = (kind: "bill" | "payout", period: string, participantId: string) =>
  `${kind === "bill" ? "ST" : "PO"}-${period.replace("-", "")}-${participantId}`.toUpperCase();

/**
 * Monthly settlement: consumers pay the group price for what they received, producers are paid the price minus the
 * operator fee for what was credited to them. Net amounts; VAT and the PayPal fee are not modelled in this stage.
 */
export function settleMonth(g: CoopGroup, m: CoopMonth): Settlement {
  validateCoopGroup(g);
  const payoutCt = g.priceCt - g.operatorFeeCt;
  const consumers = consumersOf(g).map((c) => ({
    statementId: statementId("bill", m.period, c.id),
    participantId: c.id,
    period: m.period,
    receivedWh: m.receivedWh[c.id],
    priceCt: g.priceCt,
    amountCents: centsFor(m.receivedWh[c.id], g.priceCt),
  }));
  const producers = producersOf(g).map((p) => ({
    statementId: statementId("payout", m.period, p.id),
    participantId: p.id,
    period: m.period,
    soldWh: m.soldWh[p.id],
    payoutCt,
    amountCents: centsFor(m.soldWh[p.id], payoutCt),
  }));
  const received = consumers.reduce((s, c) => s + c.receivedWh, 0);
  const sold = producers.reduce((s, p) => s + p.soldWh, 0);
  if (received !== sold) throw new Error(`Settlement ${m.period}: received ${received} Wh ≠ credited ${sold} Wh`);
  const billed = consumers.reduce((s, c) => s + c.amountCents, 0);
  const paidOut = producers.reduce((s, p) => s + p.amountCents, 0);
  const operatorRetainedCents = billed - paidOut;
  if (operatorRetainedCents < 0) throw new Error(`Settlement ${m.period}: payouts exceed bills`);
  return { groupId: g.id, period: m.period, consumers, producers, operatorRetainedCents };
}
