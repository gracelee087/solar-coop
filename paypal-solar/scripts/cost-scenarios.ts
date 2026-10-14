// Operator money after PayPal fees for the sample cooperative, under the current settings and a few alternatives.
// Local calculation only: no PayPal or Gemini call, the app's prices are not changed.
//   npx tsx scripts/cost-scenarios.ts
// "Remainder" = bills − payouts − PayPal fees. No other cost (time, hosting, model, meters, tax) is included.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { aggregateCoopMonth, consumersOf, producersOf } from "../src/lib/coop/allocation";
import { afterPaymentFees, payoutRate } from "../src/lib/coop/costs";
import { parseMeterCsv } from "../src/lib/coop/meter-csv";
import { sampleCoop } from "../src/lib/coop/sample-group";
import { settleMonth } from "../src/lib/coop/statements";
import type { CoopGroup, CoopMonth, MeterInterval, Settlement } from "../src/lib/coop/types";
import { illustrativePayPalRate } from "../src/lib/settlement-fees";

const ROOT = path.join(__dirname, "..");
const PERIOD = "2026-06";
const june = parseMeterCsv(sampleCoop, PERIOD, readFileSync(path.join(ROOT, "src", "data", `coop-meter-${PERIOD}.csv`), "utf8"));

/**
 * Bill rate actually used: "Alle anderen geschäftlichen Transaktionen", domestic, EUR, 2.99 % + 0.39 EUR per received
 * payment. The fee page lists no rate for PayPal invoices, so which row applies is an assumption.
 * Sensitivity only: the lower "Geld für Waren und Dienstleistungen senden/empfangen" row (2.49 % + 0.35 EUR); not
 * confirmed to apply to invoice payments.
 */
const RATE_OTHER = illustrativePayPalRate;
const RATE_GOODS = { ...RATE_OTHER, basisPoints: 249, fixedCents: 35 };

/** PVGIS 5.3 PVcalc, Frankfurt 50.11/8.68, 35° south, 14 % loss, kWh per kWp per month (Jan..Dec), SARAH3 2005–2023. */
const PVGIS_MONTH = [37.6, 59.4, 96.6, 123.0, 130.1, 131.3, 132.7, 121.4, 106.4, 72.2, 39.2, 30.7];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const eur = (c: number) => (c / 100).toFixed(2);
const sum = (r: Record<string, number>) => Object.values(r).reduce((s, v) => s + v, 0);

/** Approximation: June's 15-minute feed-in scaled by the month's PVGIS yield relative to June; June loads kept. */
function approxMonth(i: number): CoopMonth {
  const r = PVGIS_MONTH[i] / PVGIS_MONTH[5];
  const scaled: MeterInterval[] = june.map((iv) => ({
    ...iv,
    feedInWh: Object.fromEntries(Object.entries(iv.feedInWh).map(([k, v]) => [k, Math.round(v * r)])),
  }));
  return aggregateCoopMonth(sampleCoop, PERIOD, scaled);
}

/** One statement run over several months' energy (one bill per consumer, one payout per producer). */
function settlePeriod(g: CoopGroup, months: CoopMonth[]): Settlement {
  const add = (pick: (m: CoopMonth) => Record<string, number>) =>
    Object.fromEntries(Object.keys(pick(months[0])).map((k) => [k, months.reduce((s, m) => s + pick(m)[k], 0)]));
  return settleMonth(g, {
    period: PERIOD,
    receivedWh: add((m) => m.receivedWh),
    consumptionWh: add((m) => m.consumptionWh),
    soldWh: add((m) => m.soldWh),
    feedInWh: add((m) => m.feedInWh),
    surplusWh: add((m) => m.surplusWh),
  });
}

function row(name: string, s: Settlement, rate = RATE_OTHER) {
  const f = afterPaymentFees(s, rate);
  const sharedKWh = sum(Object.fromEntries(s.consumers.map((c) => [c.participantId, c.receivedWh]))) / 1000;
  return { name, sharedKWh: +sharedKWh.toFixed(1), ...f };
}

const base = aggregateCoopMonth(sampleCoop, PERIOD, june);
const g = (o: Partial<CoopGroup>) => ({ ...sampleCoop, ...o });

// 1. June (modelled data in the repo), one setting changed at a time.
const withBaseFee = (s: Settlement, cents: number): Settlement => ({
  ...s, consumers: s.consumers.map((c) => ({ ...c, amountCents: c.amountCents + cents })),
});
const juneRows = [
  row("current: 13 ct, operator fee 1 ct, monthly", settleMonth(sampleCoop, base)),
  row("operator fee 2 ct (price 13 ct kept, producers get 11 ct)", settleMonth(g({ operatorFeeCt: 2 }), base)),
  row("operator fee 3 ct (producers get 10 ct)", settleMonth(g({ operatorFeeCt: 3 }), base)),
  row("ASSUMED 1 EUR monthly base fee per consumer", withBaseFee(settleMonth(sampleCoop, base), 100)),
  row("sensitivity: bill fee at 2.49 % + 0.35 EUR (not confirmed for invoices)", settleMonth(sampleCoop, base), RATE_GOODS),
];
const baseFeeCt = (() => {
  const s = withBaseFee(settleMonth(sampleCoop, base), 100);
  return s.consumers.map((c) => ({ id: c.participantId, effectiveCtPerKWh: +((c.amountCents / c.receivedWh) * 1000).toFixed(2) }));
})();

// 2. Seasonal approximation, current settings.
const months = MONTHS.map((_, i) => approxMonth(i));
const seasonal = months.map((m, i) => row(`${MONTHS[i]} (approx.)`, settleMonth(sampleCoop, m)));

// 3. Billing cycle over the approximate year. Payout timing options: monthly (operator advances money) or at the end
//    of each billing period (producers wait). Bills are assumed paid on time at the end of each period.
function cycle(n: number) {
  const periods = Array.from({ length: 12 / n }, (_, k) => months.slice(k * n, k * n + n));
  const settled = periods.map((ms) => settlePeriod(sampleCoop, ms));
  const fees = settled.map((s) => afterPaymentFees(s));
  const monthlyPayouts = months.map((m) => settleMonth(sampleCoop, m).producers.reduce((s, p) => s + p.amountCents, 0));
  // Producers paid monthly: before a period's bills come in, the operator has paid out every month of that period.
  const peakAdvance = Math.max(...periods.map((_, k) => monthlyPayouts.slice(k * n, k * n + n).reduce((s, v) => s + v, 0)));
  return {
    cycle: n === 1 ? "monthly" : n === 2 ? "every 2 months" : "quarterly",
    bills: fees.reduce((s, f) => s + f.bills, 0),
    payouts: fees.reduce((s, f) => s + f.payouts, 0),
    feesCents: fees.reduce((s, f) => s + f.billFeeCents + f.payoutFeeCents, 0),
    remainderCents: fees.reduce((s, f) => s + f.remainderCents, 0),
    payoutsAtPeriodEnd: { producersWaitUpToMonths: n - 1, operatorAdvanceCents: 0 },
    payoutsMonthly: { operatorPeakAdvanceCents: n === 1 ? 0 : peakAdvance, note: "payout fees then stay monthly (not in feesCents)" },
    largestSinglePayoutCents: Math.max(...settled.flatMap((s) => s.producers.map((p) => p.amountCents))),
  };
}
const cycles = [1, 2, 3].map(cycle);

console.log(`Bill fee: ${RATE_OTHER.basisPoints / 100} % + ${eur(RATE_OTHER.fixedCents)} EUR per received payment (assumed row). ` +
  `Payout fee: ${payoutRate.basisPoints / 100} % per payment, cap ${eur(payoutRate.capCents)} EUR per payment. Cents rounded half up per transaction.`);
console.log(`\nJune 2026 (modelled), ${consumersOf(sampleCoop).length} consumers, ${producersOf(sampleCoop).length} producers`);
for (const r of juneRows) {
  console.log(`  ${r.name}: billed ${eur(r.billedCents)}, paid out ${eur(r.paidOutCents)}, retained ${eur(r.retainedCents)}, ` +
    `fees ${eur(r.billFeeCents)}+${eur(r.payoutFeeCents)} -> remainder ${eur(r.remainderCents)} EUR`);
}
console.log(`  effective consumer price with the 1 EUR base fee: ${baseFeeCt.map((b) => `${b.id} ${b.effectiveCtPerKWh}`).join(", ")} ct/kWh`);
console.log("\nSeasonal approximation (June loads, feed-in scaled by PVGIS month / June)");
for (const r of seasonal) console.log(`  ${r.name}: shared ${r.sharedKWh} kWh, retained ${eur(r.retainedCents)}, remainder ${eur(r.remainderCents)} EUR`);
console.log(`  year: remainder ${eur(seasonal.reduce((s, r) => s + r.remainderCents, 0))} EUR`);
console.log("\nBilling cycle over the approximate year");
for (const c of cycles) {
  console.log(`  ${c.cycle}: ${c.bills} bills + ${c.payouts} payouts, fees ${eur(c.feesCents)}, remainder ${eur(c.remainderCents)} EUR; ` +
    `if producers are still paid monthly the operator advances up to ${eur(c.payoutsMonthly.operatorPeakAdvanceCents)} EUR; ` +
    `largest payout ${eur(c.largestSinglePayoutCents)} EUR`);
}

const out = path.join(ROOT, "runs", "cost-scenarios");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "result.json"), JSON.stringify({
  computedAt: new Date().toISOString(),
  rates: { bill: { ...RATE_OTHER, row: "Alle anderen geschäftlichen Transaktionen (assumed for invoices)" }, billSensitivity: RATE_GOODS, payout: payoutRate },
  rounding: "whole cents, half up, per transaction (the fee page states no rule)",
  remainderIncludes: "PayPal fees only",
  june: juneRows, baseFeeCt, seasonal, cycles,
}, null, 2) + "\n");
console.log(`\nSaved runs/cost-scenarios/result.json`);
