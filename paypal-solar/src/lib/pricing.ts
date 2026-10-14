import { TARIFFS, type PricingSettings } from "./tariffs";

const round2 = (x: number) => Math.round(x * 100) / 100;
// Window edges round inwards so that a price exactly at an edge never makes either side worse off.
const ceil2 = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;
const floor2 = (x: number) => Math.floor(x * 100 + 1e-9) / 100;
/** Round to whole euro cents; `+ 0` turns -0 into 0. */
const cents = (x: number) => Math.round(x) + 0;

/** Regulated cost the consumer still pays on each shared kWh (grid fee, concession fee, levies, tax), gross. */
export function regulatedGrossCt(s: PricingSettings): number {
  const net =
    TARIFFS.gridFeeCt.value +
    TARIFFS.concessionFeeCt.value +
    TARIFFS.kwkgLevyCt.value +
    TARIFFS.offshoreLevyCt.value +
    TARIFFS.specialGridUseLevyCt.value +
    (s.electricityTaxOnShared ? TARIFFS.electricityTaxCt.value : 0);
  return net * (1 + TARIFFS.vatRate.value);
}

export interface PriceWindow {
  /** Lowest sharing price at which the producer is better off than with feed-in. */
  floorCt: number;
  /** Highest sharing price at which the neighbour is better off than with default supply. */
  ceilingCt: number;
  viable: boolean;
}

/**
 * Per-kWh window, excluding fixed monthly costs (PayPal fee, smart-meter share); use monthlyPriceWindow to settle.
 * Sharing price p (ct/kWh, no VAT: the producer is assumed to be a small business under § 19 UStG).
 * Producer nets p − fee and must beat the feed-in tariff. Consumer pays p + regulated costs and must beat default supply.
 */
export function priceWindow(s: PricingSettings): PriceWindow {
  const floorCt = ceil2(s.feedInTariffCt + s.platformFeeCt);
  const ceilingCt = floor2(s.defaultSupplyGrossCt - regulatedGrossCt(s));
  return { floorCt, ceilingCt, viable: floorCt < ceilingCt };
}

export interface MonthlyEconomics {
  sharedKWh: number;
  /** What the neighbour pays the producer for shared energy, in euro cents. */
  energyChargeCents: number;
  /** Neighbour's saving on the shared kWh vs default supply, minus the smart-meter share for the month, in euro cents. */
  consumerSavingCents: number;
  /** Producer's extra income vs feeding the same kWh into the grid, after platform and PayPal fees, in euro cents. */
  producerGainCents: number;
  platformFeeCents: number;
  /** PayPal fee on the monthly invoice payment, borne by the producer, in euro cents. */
  paypalFeeCents: number;
}

/** PayPal fee for receiving one payment of `amountCents`. */
export function paypalFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return cents((amountCents * TARIFFS.paypalFeePercent.value) / 100 + TARIFFS.paypalFixedFeeEur.value * 100);
}

export interface CostItem {
  label: string;
  /** How the amount is computed, for display, e.g. "9.23 ct/kWh (net)" or "2.99 % + 0.39 €". */
  rate: string;
  /** Price per shared kWh in ct when the item is per kWh, else null. */
  unitCt: number | null;
  /** What the rate is applied to, e.g. "131.31 kWh" or "1 month". */
  appliedTo: string;
  /** Amount for the month, in euro cents, rounded per item; all totals are sums of these. */
  cents: number;
  payer: "neighbour" | "producer";
  receivedBy: string;
  source: string;
  /** Assumption or caveat behind the value, if any. */
  note?: string;
}

export interface MonthlyBreakdown {
  sharedKWh: number;
  /** ① What the neighbour pays the producer: the PayPal invoice. */
  invoice: CostItem;
  /** ② What the neighbour still pays others on the shared kWh, outside the PayPal invoice. */
  neighbourOtherCosts: CostItem[];
  /** Comparison basis, not a cost of sharing: the same kWh from default supply. */
  neighbourAlternative: CostItem;
  /** ③ Deducted from the producer's invoice income. */
  producerCosts: CostItem[];
  /** Comparison basis, not an expense: income from feeding the same kWh into the grid. */
  producerAlternative: CostItem;
}

/**
 * Every cost of one neighbour's shared energy in one month, per item: rate, quantity, amount, who pays,
 * who receives it, source. Only the energy price between neighbours goes through PayPal; the regulated
 * components are billed by the electricity supplier, with VAT shown as its own line.
 */
export function monthlyBreakdown(sharedWh: number, priceCt: number, s: PricingSettings): MonthlyBreakdown {
  const kWh = sharedWh / 1000;
  const qty = `${round2(kWh).toFixed(2)} kWh`;
  const T = TARIFFS;
  const fmt = (ct: number) => `${Number(ct.toFixed(3))} ct/kWh`;
  const perKWh = (
    label: string,
    unitCt: number,
    rate: string,
    payer: CostItem["payer"],
    receivedBy: string,
    source: string,
    note?: string,
  ): CostItem => ({ label, rate, unitCt, appliedTo: qty, cents: cents(kWh * unitCt), payer, receivedBy, source, note });
  const supplier = "Electricity supplier (passes it on to grid operator, municipality, state)";

  const invoice = perKWh(
    "Shared solar energy",
    priceCt,
    `${fmt(priceCt)}, agreed price`,
    "neighbour",
    "Producer, via PayPal invoice",
    "Negotiated in this demo",
    "No VAT: the producer is assumed to be a small business under § 19 UStG.",
  );

  const net: [string, number, string, string?][] = [
    ["Grid fee (NRM)", T.gridFeeCt.value, T.gridFeeCt.source, "Not reduced for shared energy under § 42c EnWG."],
    ["Concession fee", T.concessionFeeCt.value, T.concessionFeeCt.source],
    ["CHP levy (KWKG)", T.kwkgLevyCt.value, T.kwkgLevyCt.source],
    ["Offshore grid levy", T.offshoreLevyCt.value, T.offshoreLevyCt.source],
    ["Special grid-use surcharge", T.specialGridUseLevyCt.value, T.specialGridUseLevyCt.source, "Aufschlag für besondere Netznutzung."],
  ];
  if (s.electricityTaxOnShared) {
    net.push([
      "Electricity tax",
      T.electricityTaxCt.value,
      T.electricityTaxCt.source,
      "Assumed to apply; an exemption for sharing within 4.5 km is debated.",
    ]);
  }
  const netSumCt = net.reduce((t, [, ct]) => t + ct, 0);
  const vatCt = netSumCt * T.vatRate.value;

  const neighbourOtherCosts: CostItem[] = [
    ...net.map(([label, ct, source, note]) => perKWh(label, ct, `${fmt(ct)} (net)`, "neighbour", supplier, source, note)),
    perKWh("VAT on the items above", vatCt, `${T.vatRate.value * 100} % of ${fmt(netSumCt)}`, "neighbour", "Electricity supplier (for the tax office)", T.vatRate.source),
    {
      label: "Smart-meter share",
      rate: `${T.smartMeterUserEurPerYear.value} € per year ÷ 12, incl. VAT`,
      unitCt: null,
      appliedTo: "1 month",
      cents: cents((T.smartMeterUserEurPerYear.value * 100) / 12),
      payer: "neighbour",
      receivedBy: "Smart-meter operator",
      source: T.smartMeterUserEurPerYear.source,
      note: "Counted as a cost of sharing: the 15-minute meter is required for it. Optional installation; the user's half of the 60 € gross cap.",
    },
  ];

  const producerCosts: CostItem[] = [
    {
      label: "PayPal fee",
      rate: `${T.paypalFeePercent.value} % + ${T.paypalFixedFeeEur.value.toFixed(2)} € per payment`,
      unitCt: null,
      appliedTo: `${(invoice.cents / 100).toFixed(2)} € payment`,
      cents: paypalFeeCents(invoice.cents),
      payer: "producer",
      receivedBy: "PayPal (deducted from the payment)",
      source: T.paypalFeePercent.source,
      note: "Commercial rate assumed; no separate rate for invoices is published.",
    },
    perKWh(
      "Platform fee",
      s.platformFeeCt,
      fmt(s.platformFeeCt),
      "producer",
      "Energy-sharing service provider",
      T.platformFeeCt.source,
      "Demo assumption, partly backed (secondary source): the platform operator WeShareEnergy charges 1 ct per traded kWh without saying who pays; another 1 ct margin applies only above the EEG tariff. VAT not stated.",
    ),
  ];

  return {
    sharedKWh: round2(kWh),
    invoice,
    neighbourOtherCosts,
    neighbourAlternative: perKWh(
      "Default supply (Mainova Strom Classic)",
      s.defaultSupplyGrossCt,
      `${fmt(s.defaultSupplyGrossCt)}, incl. VAT`,
      "neighbour",
      "Mainova",
      T.defaultSupplyGrossCt.source,
    ),
    producerCosts,
    producerAlternative: perKWh(
      "EEG feed-in tariff",
      s.feedInTariffCt,
      fmt(s.feedInTariffCt),
      "producer",
      "Producer (paid by the grid operator)",
      T.feedInTariffCt.source,
      "Rate for systems commissioned Aug–Dec 2026, ≤ 10 kW part, partial feed-in.",
    ),
  };
}

const sum = (items: CostItem[]) => items.reduce((t, i) => t + i.cents, 0) + 0;

/** The money each side sees for one neighbour's month. Every figure is a sum of breakdown lines. */
export interface MoneyFlows {
  neighbour: {
    paidToProducerCents: number;
    otherCostsCents: number;
    /** Total cost related to the shared energy (not the household's whole electricity bill). */
    totalCents: number;
    withoutSharingCents: number;
    savingCents: number;
  };
  producer: {
    salesCents: number;
    deductionsCents: number;
    netReceivedCents: number;
    /** Comparison basis: income if the same kWh had been fed into the grid. Not an expense. */
    gridAlternativeCents: number;
    extraGainCents: number;
  };
}

export function moneyFlows(b: MonthlyBreakdown): MoneyFlows {
  const otherCostsCents = sum(b.neighbourOtherCosts);
  const totalCents = b.invoice.cents + otherCostsCents;
  const deductionsCents = sum(b.producerCosts);
  const netReceivedCents = b.invoice.cents - deductionsCents;
  return {
    neighbour: {
      paidToProducerCents: b.invoice.cents,
      otherCostsCents,
      totalCents,
      withoutSharingCents: b.neighbourAlternative.cents,
      savingCents: b.neighbourAlternative.cents - totalCents,
    },
    producer: {
      salesCents: b.invoice.cents,
      deductionsCents,
      netReceivedCents,
      gridAlternativeCents: b.producerAlternative.cents,
      extraGainCents: netReceivedCents - b.producerAlternative.cents,
    },
  };
}

/** Totals of monthlyBreakdown, so the item lines and the totals always agree. */
export function monthlyEconomics(sharedWh: number, priceCt: number, s: PricingSettings): MonthlyEconomics {
  const b = monthlyBreakdown(sharedWh, priceCt, s);
  const f = moneyFlows(b);
  return {
    sharedKWh: b.sharedKWh,
    energyChargeCents: b.invoice.cents,
    consumerSavingCents: f.neighbour.savingCents,
    producerGainCents: f.producer.extraGainCents,
    platformFeeCents: b.producerCosts[1].cents,
    paypalFeeCents: b.producerCosts[0].cents,
  };
}

/**
 * Window for one neighbour's month, including the fixed costs: every price in 0.01 ct steps at which, after
 * rounding to cents, the producer earns at least 1 cent more than with feed-in (after platform and PayPal fees)
 * and the neighbour saves at least 1 cent against default supply (after the smart-meter share). A break-even of
 * exactly 0 does not count as better off. Without such a price the month is not viable: no sharing deal.
 */
export function monthlyPriceWindow(sharedWh: number, s: PricingSettings): PriceWindow {
  const prices = Array.from({ length: Math.round(s.defaultSupplyGrossCt * 100) + 1 }, (_, i) => i / 100);
  const producerOk = (p: number) => monthlyEconomics(sharedWh, p, s).producerGainCents >= 1;
  const consumerOk = (p: number) => monthlyEconomics(sharedWh, p, s).consumerSavingCents >= 1;
  const floorCt = prices.find(producerOk) ?? Infinity;
  const ceilingCt = [...prices].reverse().find(consumerOk) ?? -Infinity;
  // Cent rounding could leave a gap inside the window; only a gap-free window counts as viable.
  const inside = prices.filter((p) => p >= floorCt && p <= ceilingCt);
  const viable = inside.length > 0 && inside.every((p) => producerOk(p) && consumerOk(p));
  return { floorCt, ceilingCt, viable };
}
