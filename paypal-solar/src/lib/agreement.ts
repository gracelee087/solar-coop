import record from "../data/agreements.json";
import { settlementKey } from "./invoice";
import type { NegotiationResult, Offer, ProposalSource } from "./negotiation";
import type { PriceWindow } from "./pricing";
import type { SharingGroup } from "./types";

/**
 * Terms agreed for one settlement, saved when the negotiation ends. The settlement uses only this record, so a
 * later negotiation run (live, or a different model) cannot change what is billed. Saved records are not overwritten.
 */
export interface Agreement {
  settlementKey: string;
  period: string;
  producer: { id: string; name: string };
  neighbour: { id: string; name: string; allocationKey: number };
  priceCt: number;
  /** What the price was negotiated on, before supply. */
  basis: { expectedSharedKWh: number; weatherYears: string; window: PriceWindow };
  /**
   * The negotiation as it happened: every offer with price, message, stated reason, code-computed concession and
   * who proposed it (Gemini with model name, or the rule), plus how it ended.
   */
  negotiation: { rounds: number; sources: ProposalSource[]; offers: Offer[]; outcome: string };
  /** ISO time the agreement was saved. */
  agreedAt: string;
  note?: string;
}

export type AgreementStore = Record<string, Agreement>;

export function makeAgreement(a: {
  period: string;
  group: SharingGroup;
  householdId: string;
  result: NegotiationResult;
  expectedSharedKWh: number;
  weatherYears: string;
  window: PriceWindow;
  agreedAt: string;
  note?: string;
}): Agreement | null {
  const h = a.group.households.find((x) => x.id === a.householdId);
  if (!h || !a.result.agreed || a.result.priceCt === null) return null;
  return {
    settlementKey: settlementKey(a.period, a.group.producer.id, h.id),
    period: a.period,
    producer: { id: a.group.producer.id, name: a.group.producer.name },
    neighbour: { id: h.id, name: h.name, allocationKey: h.key },
    priceCt: a.result.priceCt,
    basis: { expectedSharedKWh: a.expectedSharedKWh, weatherYears: a.weatherYears, window: a.window },
    negotiation: {
      rounds: a.result.offers.length,
      sources: a.result.offers.map((o) => o.source),
      offers: a.result.offers,
      outcome: a.result.reason,
    },
    agreedAt: a.agreedAt,
    ...(a.note ? { note: a.note } : {}),
  };
}

/** Reasons not to settle on this record with the current group; empty when it can be used. */
export function checkAgreement(a: Agreement, group: SharingGroup, period: string): string[] {
  const problems: string[] = [];
  const h = group.households.find((x) => x.id === a.neighbour.id);
  if (a.period !== period) problems.push(`agreement is for ${a.period}, not ${period}`);
  if (a.producer.id !== group.producer.id) problems.push(`producer ${a.producer.id} is not in this group`);
  if (!h) problems.push(`neighbour ${a.neighbour.id} is not in this group`);
  else if (h.key !== a.neighbour.allocationKey) problems.push(`allocation key changed from ${a.neighbour.allocationKey} to ${h.key}`);
  if (a.settlementKey !== settlementKey(a.period, a.producer.id, a.neighbour.id)) problems.push(`settlement key ${a.settlementKey} does not match its terms`);
  const w = a.basis.window;
  if (!Number.isFinite(a.priceCt)) problems.push("price is not a number");
  else if (!w.viable || a.priceCt < w.floorCt || a.priceCt > w.ceilingCt) problems.push(`price ${a.priceCt} ct is outside the window ${w.floorCt}–${w.ceilingCt} ct`);
  return problems;
}

/**
 * Checks before a Gemini negotiation is saved: everything checkAgreement checks, the price inside both private
 * limits, and every offer proposed by Gemini (a rule-based fallback offer means the run is not saved).
 */
export function checkBeforeSave(a: Agreement, group: SharingGroup, period: string, limits: { producerMinCt: number; neighbourMaxCt: number }): string[] {
  const problems = checkAgreement(a, group, period);
  if (a.priceCt < limits.producerMinCt || a.priceCt > limits.neighbourMaxCt) {
    problems.push(`price ${a.priceCt} ct is outside the private limits ${limits.producerMinCt}–${limits.neighbourMaxCt} ct`);
  }
  if (a.negotiation.offers.length === 0) problems.push("no offers recorded");
  a.negotiation.offers.forEach((o, i) => {
    if (o.source.kind !== "gemini") problems.push(`offer ${i + 1} was not proposed by Gemini`);
  });
  return problems;
}

/** Adds a new record; refuses to replace a saved one, so an agreed price is never changed afterwards. */
export function addAgreement(store: AgreementStore, a: Agreement): { store: AgreementStore } | { error: string } {
  const saved = store[a.settlementKey];
  if (saved) return { error: `${a.settlementKey} was already agreed at ${saved.priceCt} ct on ${saved.agreedAt}` };
  return { store: { ...store, [a.settlementKey]: a } };
}

const saved = record.agreements as AgreementStore;

export function findAgreement(key: string): Agreement | null {
  return saved[key] ?? null;
}

export function allAgreements(): Agreement[] {
  return Object.values(saved);
}
