import type { CoopGroup } from "./types";

/**
 * Sample cooperative of 10 households: three with rooftop PV, seven without. Illustrative, not real people.
 * Annual consumption (used only to generate the sample CSV) follows Stromspiegel 2025 houses without electric water
 * heating (2 persons 2,700 kWh, 3 persons 3,500 kWh, 4 persons 3,800 kWh), as in demo-group.ts. Price and operator
 * fee are illustrative assumptions: the price sits between the 7.70 ct EEG feed-in tariff and the 38.78 ct default
 * supply price (tariffs.ts); the 1 ct fee mirrors the partly sourced platform fee there.
 * E-mails use the reserved example.com domain; no payment is executed against them in this stage.
 */
export const sampleCoop: CoopGroup & { annualKWh: Record<string, number> } = {
  id: "coop-frankfurt-demo",
  participants: [
    { id: "H01", name: "Haus 1", role: "producer", email: "h01@example.com" },
    { id: "H02", name: "Haus 2", role: "producer", email: "h02@example.com" },
    { id: "H03", name: "Haus 3", role: "producer", email: "h03@example.com" },
    { id: "H04", name: "Haus 4", role: "consumer", email: "h04@example.com" },
    { id: "H05", name: "Haus 5", role: "consumer", email: "h05@example.com" },
    { id: "H06", name: "Haus 6", role: "consumer", email: "h06@example.com" },
    { id: "H07", name: "Haus 7", role: "consumer", email: "h07@example.com" },
    { id: "H08", name: "Haus 8", role: "consumer", email: "h08@example.com" },
    { id: "H09", name: "Haus 9", role: "consumer", email: "h09@example.com" },
    { id: "H10", name: "Haus 10", role: "consumer", email: "h10@example.com" },
  ],
  assets: [
    { id: "PV01", ownerId: "H01", kWp: 9.8 },
    { id: "PV02", ownerId: "H02", kWp: 7.2 },
    { id: "PV03", ownerId: "H03", kWp: 5.5 },
  ],
  keys: { H04: 0.14, H05: 0.14, H06: 0.14, H07: 0.14, H08: 0.14, H09: 0.14, H10: 0.14 },
  priceCt: 13,
  operatorFeeCt: 1,
  annualKWh: {
    H01: 3800, H02: 3500, H03: 2700,
    H04: 2700, H05: 3500, H06: 3800, H07: 2700, H08: 3500, H09: 3800, H10: 2700,
  },
};
