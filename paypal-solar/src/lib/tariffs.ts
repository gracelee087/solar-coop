/**
 * Real 2026 price parameters for Frankfurt am Main (grid operator NRM, default supplier Mainova).
 * Every value carries its source and the validity stated there, so the UI can show both. Values marked
 * "partial" are only partly backed by their source; "assumption" values are not confirmed market prices.
 * Each source was opened and checked on 2026-10-13 (see DATA_SOURCES.md).
 */

export type Confidence = "confirmed" | "partial" | "assumption";

export interface Param {
  value: number;
  unit: string;
  source: string;
  confidence: Confidence;
  /** Validity as stated in the source (or that the source states none). */
  validity: string;
}

const MAINOVA_DISCLOSURE =
  "https://www.mainova.de/resource/blob/135306/e6211b5f62387895e0869be5d112b5ef/pflichtangaben-strom-classic-01012026-data.pdf";
const NRM_PRICE_SHEET =
  "https://www.nrm-netzdienste.de/resource/blob/162202/19a814ee3b72701e0d3e752dd10a83e1/20251212-nrm-pb-1-strom-ab-01-01-2026-el-8-0-s-1--data.xlsx";
const FROM_2026 = "from 2026-01-01, no end date stated";

export const TARIFFS = {
  /** What a neighbour pays today without sharing: Mainova default supply "Strom Classic", gross. */
  defaultSupplyGrossCt: { value: 38.78, unit: "ct/kWh gross", source: MAINOVA_DISCLOSURE, confidence: "confirmed", validity: FROM_2026 },
  vatRate: { value: 0.19, unit: "share", source: MAINOVA_DISCLOSURE, confidence: "confirmed", validity: FROM_2026 },
  /**
   * Base fee of the same supply contract (includes the grid base fee of 34.98 €/year net); assumed to be paid
   * with and without sharing, so not part of the comparison.
   */
  supplyBaseFeeEurPerYear: { value: 91.49, unit: "€/year gross", source: MAINOVA_DISCLOSURE, confidence: "confirmed", validity: FROM_2026 },

  // Regulated components still charged on every shared kWh (no reduction under § 42c EnWG), net.
  /** NRM price sheet row "Arbeitspreis ST", category "sonstiger Verbrauch"; Mainova lists the same 9.230 ct/kWh net. */
  gridFeeCt: { value: 9.23, unit: "ct/kWh net", source: NRM_PRICE_SHEET, confidence: "confirmed", validity: FROM_2026 },
  concessionFeeCt: { value: 2.39, unit: "ct/kWh net", source: MAINOVA_DISCLOSURE, confidence: "confirmed", validity: FROM_2026 },
  kwkgLevyCt: { value: 0.446, unit: "ct/kWh net", source: MAINOVA_DISCLOSURE, confidence: "confirmed", validity: FROM_2026 },
  offshoreLevyCt: { value: 0.941, unit: "ct/kWh net", source: MAINOVA_DISCLOSURE, confidence: "confirmed", validity: FROM_2026 },
  /** "Aufschlag für besondere Netznutzung" in the Mainova disclosure. */
  specialGridUseLevyCt: { value: 1.559, unit: "ct/kWh net", source: MAINOVA_DISCLOSURE, confidence: "confirmed", validity: FROM_2026 },
  electricityTaxCt: {
    value: 2.05,
    unit: "ct/kWh net",
    source: "https://www.gesetze-im-internet.de/stromstg/__3.html",
    confidence: "confirmed",
    validity: "no date on the source page",
  },

  /** Producer's alternative: EEG feed-in tariff, building system ≤10 kW, partial feed-in, commissioned Aug–Dec 2026. */
  feedInTariffCt: {
    value: 7.7,
    unit: "ct/kWh",
    source:
      "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/ErneuerbareEnergien/EEG_Foerderung/start.html",
    confidence: "confirmed",
    validity: "commissioning 2026-08-01 to 2026-12-31",
  },

  /**
   * Service-provider charge per shared kWh, assumed to be deducted from the producer. The source names two
   * 1 ct charges: WeShareEnergy (the platform operator) charges 1 ct per traded kWh without saying who pays,
   * and the Mitmachstrom margin of 1 ct applies only to the part of the price above the EEG tariff.
   */
  platformFeeCt: {
    value: 1.0,
    unit: "ct/kWh",
    source: "https://www.solarserver.de/2026/09/02/bund-der-energieverbraucher-startet-energy-sharing-mitmachstrom/",
    confidence: "partial",
    validity: "article of 2026-09-02, no validity stated",
  },

  /**
   * PayPal fee the producer pays on each received payment (Germany, domestic commercial rate).
   * The fee page lists no separate rate for PayPal invoices, so the commercial rate is assumed.
   */
  paypalFeePercent: {
    value: 2.99,
    unit: "% of amount",
    source: "https://www.paypal.com/de/business/paypal-business-fees",
    confidence: "partial",
    validity: "page last updated 2026-09-07, no start date",
  },
  paypalFixedFeeEur: {
    value: 0.39,
    unit: "€ per payment",
    source: "https://www.paypal.com/de/business/paypal-business-fees",
    confidence: "partial",
    validity: "page last updated 2026-09-07, no start date",
  },

  /**
   * Consumer's own cost of joining: an optionally installed smart meter. 30 € gross per year is the user's half
   * of the 60 € gross cap the default meter operator may charge (§ 30(3) MsbG).
   */
  smartMeterUserEurPerYear: {
    value: 30,
    unit: "€/year gross",
    source: "https://www.gesetze-im-internet.de/messbg/__30.html",
    confidence: "confirmed",
    validity: "from 2025-01-01, until a BNetzA determination replaces the caps (§ 30(6) MsbG)",
  },
} satisfies Record<string, Param>;

export interface PricingSettings {
  /** Electricity tax on shared kWh. Exempt within 4.5 km per § 9 StromStG reading; disputed (dena says it applies). */
  electricityTaxOnShared: boolean;
  platformFeeCt: number;
  feedInTariffCt: number;
  defaultSupplyGrossCt: number;
}

export const defaultSettings: PricingSettings = {
  electricityTaxOnShared: true, // conservative default
  platformFeeCt: TARIFFS.platformFeeCt.value,
  feedInTariffCt: TARIFFS.feedInTariffCt.value,
  defaultSupplyGrossCt: TARIFFS.defaultSupplyGrossCt.value,
};
