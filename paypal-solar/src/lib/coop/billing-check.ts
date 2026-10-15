import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { aggregateCoopMonth } from "./allocation";
import type { ApprovalFacts } from "./approval";
import type { PaymentDraft } from "./ledger";
import { parseMeterCsv } from "./meter-csv";
import { centsFor, statementId } from "./statements";
import type { CoopGroup, MeterInterval } from "./types";

/** What a run was billed from, saved with the run so a later check can tell whether it compares like with like. */
export interface BillingInputs {
  meterFile: string;
  meterSha256: string;
  priceCt: number;
  keys: Record<string, number>;
}

export interface MeterMonth {
  file: string;
  sha256: string;
  intervals: MeterInterval[];
}

export const meterFileFor = (period: string) => `src/data/coop-meter-${period}.csv`;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function billingInputs(g: CoopGroup, file: string, text: string): BillingInputs {
  return { meterFile: file, meterSha256: sha256(text), priceCt: g.priceCt, keys: { ...g.keys } };
}

/** The current meter file for a period under `root`, or null if there is none. */
export function loadMeterMonth(root: string, g: CoopGroup, period: string): MeterMonth | null {
  const file = meterFileFor(period);
  const full = path.join(root, file);
  if (!existsSync(full)) return null;
  const text = readFileSync(full, "utf8");
  return { file, sha256: sha256(text), intervals: parseMeterCsv(g, period, text) };
}

export type LinkStatus = "match" | "mismatch" | "not_comparable" | "pending";

/**
 * Payment state as recorded in the ledger and the saved PayPal observation. Sending an invoice is not a payment:
 * only a reconciled PAID observation counts as paid.
 */
export interface PaymentState {
  status: "not_sent" | "sent_not_checked" | "sent_unpaid" | "paid" | "provider_mismatch" | "failed";
  label: string;
  /** Which PayPal record was checked, if any (saved observation, not a live call). */
  observed?: { field: string; value: string; reference: string | null; amount: string | null; checkedAt: string };
}

export function paymentState(d: PaymentDraft): PaymentState {
  const sent = d.kind === "payout" ? "Payout" : "Invoice";
  const r = d.reconciliation;
  const observed = r && {
    field: d.kind === "payout" ? "payout item transaction_status" : "invoice status",
    value: r.observed.externalStatus, reference: r.observed.reference, amount: r.observed.amount, checkedAt: r.checkedAt,
  };
  if (d.status === "failed") return { status: "failed", label: `${sent} send failed or its outcome is unknown. Not paid.` };
  if (d.status !== "executed") return { status: "not_sent", label: `${sent} not sent yet (ledger: ${d.status.replaceAll("_", " ")}). Not paid.` };
  if (!r) return { status: "sent_not_checked", label: `${sent} sent (reference ${d.result?.externalId ?? "unknown"}). PayPal payment status not checked yet. Not confirmed as paid.` };
  if (r.status === "matched") return { status: "paid", label: `${d.kind === "payout" ? "Paid out" : "Paid"}: PayPal reported ${r.observed.externalStatus}; ${r.reason}.`, observed };
  if (r.status === "pending") return { status: "sent_unpaid", label: `${sent} sent. PayPal reported ${r.observed.externalStatus}: ${r.reason}. Not paid.`, observed };
  return { status: "provider_mismatch", label: `PayPal record does not match the statement: ${r.reason}.`, observed };
}

export interface BillChain {
  statementId: string;
  period: string;
  meter: { file: string; sha256: string; recordedSha256: string | null; quarterHours: number; consumptionWh: number } | null;
  allocation: {
    key: number;
    receivedWh: number;
    /** Consumption not covered by the shared pool: supplied and billed by the household's own supplier. */
    residualWh: number;
    /** Part of the residual in quarter-hours when the group had no shared feed-in at all (for example at night). */
    residualNoPoolWh: number;
    /** Part of the residual in quarter-hours when the household used more than its share of the pool. */
    residualAboveShareWh: number;
  } | null;
  bill: { recordedKWh: string; recomputedKWh: string | null; recordedPriceCt: string; contractPriceCt: number; recordedCents: number; recomputedCents: number | null };
  links: { step: "meter" | "allocation" | "bill" | "payment"; status: LinkStatus; text: string }[];
  /** Whether the recorded bill agrees with a recomputation from the same meter data and contract terms. */
  billStatus: Exclude<LinkStatus, "pending">;
  payment: PaymentState;
}

const kwh = (wh: number) => (wh / 1000).toFixed(1);
const eur = (cents: number) => (cents / 100).toFixed(2);
const sameKeys = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

/**
 * Checks one recorded bill link by link: meter values + allocation rule → shared energy → billed kWh and amount →
 * the PayPal record of that statement. The recorded values are read from the ledger and approval facts and are never
 * replaced by the recomputation. Consumption above the shared energy is normal (residual supply), not an error.
 */
export function checkBill(input: {
  group: CoopGroup;
  period: string;
  draft: PaymentDraft;
  facts: ApprovalFacts;
  meter: MeterMonth | null;
  recorded: BillingInputs | undefined;
}): BillChain {
  const { group, period, draft, facts, meter, recorded } = input;
  const id = draft.participantId;
  const links: BillChain["links"] = [];
  const bill: BillChain["bill"] = {
    recordedKWh: facts.kWh, recomputedKWh: null, recordedPriceCt: facts.priceCt, contractPriceCt: group.priceCt,
    recordedCents: draft.amountCents, recomputedCents: null,
  };
  const payment = paymentState(draft);
  const paymentLink = {
    step: "payment" as const,
    status: (payment.status === "paid" ? "match" : payment.status === "provider_mismatch" || payment.status === "failed" ? "mismatch" : "pending") as LinkStatus,
    text: payment.label,
  };
  if (!meter) {
    links.push({ step: "meter", status: "not_comparable", text: `No meter file ${meterFileFor(period)} is available to check this bill.` });
    links.push({ step: "bill", status: "not_comparable", text: `Recorded bill ${facts.kWh} kWh × ${facts.priceCt} ct = ${facts.amountEur} €. Not compared: no meter data.` });
    links.push(paymentLink);
    return { statementId: draft.statementId, period, meter: null, allocation: null, bill, links, billStatus: "not_comparable", payment };
  }
  const month = aggregateCoopMonth(group, period, meter.intervals);
  let residualNoPoolWh = 0;
  for (const iv of meter.intervals) {
    const pool = Object.values(iv.feedInWh).reduce((s, v) => s + v, 0);
    if (pool === 0) residualNoPoolWh += iv.consumptionWh[id];
  }
  const receivedWh = month.receivedWh[id];
  const consumptionWh = month.consumptionWh[id];
  const residualWh = consumptionWh - receivedWh;
  const allocation = { key: group.keys[id], receivedWh, residualWh, residualNoPoolWh, residualAboveShareWh: residualWh - residualNoPoolWh };
  bill.recomputedKWh = kwh(receivedWh);
  bill.recomputedCents = centsFor(receivedWh, group.priceCt);

  const recordedSha = recorded?.meterSha256 ?? null;
  links.push({
    step: "meter",
    status: recordedSha === null ? "not_comparable" : recordedSha === meter.sha256 ? "match" : "not_comparable",
    text: `${meter.file}: ${meter.intervals.length} quarter-hours in ${period}; ${kwh(consumptionWh)} kWh consumed in total. ` +
      (recordedSha === null ? "This saved run does not record which meter file it was billed from."
        : recordedSha === meter.sha256 ? "Same file version as at billing."
        : "The meter file changed since billing; the bill cannot be compared with it."),
  });
  links.push({
    step: "allocation",
    status: "match",
    text: `Each quarter-hour: ${Math.round(allocation.key * 100)} % of the group's pooled feed-in, at most what the household used. ` +
      `Shared: ${kwh(receivedWh)} kWh. Residual from the household's own supplier: ${kwh(residualWh)} kWh ` +
      `(${kwh(residualNoPoolWh)} kWh when no solar was shared, ${kwh(allocation.residualAboveShareWh)} kWh above the household's share). ` +
      `${kwh(receivedWh)} + ${kwh(residualWh)} = ${kwh(consumptionWh)} kWh.`,
  });

  const problems: string[] = [];
  const terms = recorded ? recorded.priceCt === group.priceCt && sameKeys(recorded.keys, group.keys) : null;
  if (draft.period !== period || facts.period !== period) problems.push(`period ${draft.period} ≠ ${period}`);
  if (draft.statementId !== statementId("bill", period, id)) problems.push(`statement id ${draft.statementId} does not belong to ${id} in ${period}`);
  if (facts.amountEur !== eur(draft.amountCents)) problems.push(`approval shows ${facts.amountEur} € but the ledger holds ${eur(draft.amountCents)} €`);
  const comparable = recordedSha === meter.sha256 && terms === true;
  if (comparable) {
    if (facts.kWh !== bill.recomputedKWh) problems.push(`billed ${facts.kWh} kWh ≠ recomputed ${bill.recomputedKWh} kWh`);
    if (facts.priceCt !== group.priceCt.toFixed(2)) problems.push(`billed ${facts.priceCt} ct/kWh ≠ contract ${group.priceCt.toFixed(2)} ct/kWh`);
    if (draft.amountCents !== bill.recomputedCents) problems.push(`billed ${eur(draft.amountCents)} € ≠ recomputed ${eur(bill.recomputedCents)} €`);
  }
  const billStatus: BillChain["billStatus"] = problems.length ? "mismatch" : comparable ? "match" : "not_comparable";
  links.push({
    step: "bill",
    status: billStatus,
    text: billStatus === "mismatch" ? `Bill does not agree: ${problems.join("; ")}.`
      : billStatus === "match" ? `Billed ${facts.kWh} kWh × ${facts.priceCt} ct = ${facts.amountEur} €, equal to the recomputation (whole Wh and cents).`
      : `Recorded bill ${facts.kWh} kWh × ${facts.priceCt} ct = ${facts.amountEur} €. Not compared: ${terms === false ? "contract terms changed since billing" : "billing inputs are not recorded with this run or the meter file changed"}.`,
  });
  links.push(paymentLink);
  return {
    statementId: draft.statementId, period,
    meter: { file: meter.file, sha256: meter.sha256, recordedSha256: recordedSha, quarterHours: meter.intervals.length, consumptionWh },
    allocation, bill, links, billStatus, payment,
  };
}
