import type { Party } from "./negotiation";
import type { SharingGroup } from "./types";

/**
 * Annual consumption from Stromspiegel 2025 (houses, no electric water heating: 2 persons 2,700 kWh,
 * 3 persons 3,500 kWh, 4 persons 3,800 kWh) and co2online 2026 for PV households (3–4 persons, PV only: 3,700 kWh).
 */
export const demoGroup: SharingGroup = {
  producer: { id: "p1", name: "Rooftop PV (Haus 12)", kWp: 9.8, annualKWh: 3700 },
  households: [
    { id: "h1", name: "Haus 10", key: 0.3, annualKWh: 2700 },
    { id: "h2", name: "Haus 14", key: 0.3, annualKWh: 3800 },
    { id: "h3", name: "Haus 16", key: 0.2, annualKWh: 3500 },
  ],
};

/** PayPal sandbox accounts playing each household (fake test accounts, no real money). */
export const sandboxEmails: Record<string, string> = {
  p1: "sb-c6nah53337070@business.example.com",
  h1: "sb-pghul53340264@personal.example.com",
  h2: "sb-mocy053340320@personal.example.com",
  h3: "sb-jeitd53340338@personal.example.com",
};

/** Demo negotiation personas. Limits are illustrative assumptions, not market data. */
export const demoProducer: Party = {
  role: "producer",
  name: "Haus 12",
  limitCt: 11,
  persona: "Paid off the panels, wants clearly more than the 7.70 ct feed-in tariff, but values good relations with the street.",
};

export const demoConsumers: Record<string, Party> = {
  h1: { role: "consumer", name: "Haus 10", limitCt: 13.5, persona: "Retired couple on a tight budget; every cent counts." },
  h2: { role: "consumer", name: "Haus 14", limitCt: 16, persona: "Family of four; wants a fair, predictable price." },
  h3: { role: "consumer", name: "Haus 16", limitCt: 18, persona: "Cares about local green energy and is happy to pay a bit more for it." },
};
