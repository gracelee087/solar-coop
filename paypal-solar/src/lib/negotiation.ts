import type { PriceWindow } from "./pricing";

/**
 * Agent-to-agent price negotiation between the producer ("Sharing-Lieferant") and one neighbour
 * ("Sharing-Abnehmer"). The protocol is deterministic and enforces the limits; the policy (LLM or rule)
 * only proposes prices and messages. Whatever a policy proposes, the agreed price is guaranteed to lie
 * inside both parties' private limits and the legal/economic price window.
 */

export type Role = "producer" | "consumer";

export interface Party {
  role: Role;
  name: string;
  /** Private limit: producer's minimum or consumer's maximum price, ct/kWh. Never shown to the other side. */
  limitCt: number;
  /** Short description of what this party cares about; used by the LLM policy. */
  persona: string;
}

export interface Offer {
  round: number;
  from: Role;
  priceCt: number;
  message: string;
  /** The proposer's own stated reason for this price (model or rule text; not checked by code). */
  reason: string;
  /**
   * How far this offer moved from the same party's previous offer, ct/kWh, computed by the protocol from the
   * guarded prices (null for a party's first offer). Concession sizes are never taken from model text.
   */
  concessionCt: number | null;
  /** True when the protocol had to correct the policy's proposed price to stay within the rules. */
  adjusted: boolean;
  /** Who proposed it: the LLM (with model name) or the deterministic rule. */
  source: ProposalSource;
}

export type ProposalSource = { kind: "gemini"; model: string } | { kind: "rules"; reason?: string };

export interface PolicyInput {
  self: Party;
  window: PriceWindow;
  history: Offer[];
  round: number;
  maxRounds: number;
}

export interface Proposal {
  priceCt: number;
  message: string;
  /** Why this price, one short sentence without numbers. */
  reason: string;
  source: ProposalSource;
}

export type Policy = (input: PolicyInput) => Promise<Proposal>;

export interface NegotiationResult {
  agreed: boolean;
  priceCt: number | null;
  offers: Offer[];
  reason: string;
}

/** A live negotiation run from the dashboard: a preview that is never saved. */
export interface LiveNegotiation {
  at: string;
  householdId: string;
  window: PriceWindow;
  /** How the offers were produced, e.g. "Live Gemini" or "Live Gemini, rule-based fallback for 2 of 9 offers". */
  label: string;
  result: NegotiationResult;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Clamp a proposal to the party's limit, the window, and "no backtracking" on its own previous offer. */
function guard(price: number, self: Party, window: PriceWindow, previousOwn: number | undefined): number {
  let p = Number.isFinite(price) ? price : self.role === "producer" ? window.ceilingCt : window.floorCt;
  p = Math.min(Math.max(p, window.floorCt), window.ceilingCt);
  if (self.role === "producer") {
    p = Math.max(p, self.limitCt);
    if (previousOwn !== undefined) p = Math.min(p, previousOwn);
  } else {
    p = Math.min(p, self.limitCt);
    if (previousOwn !== undefined) p = Math.max(p, previousOwn);
  }
  return round2(p);
}

export async function negotiate(
  producer: Party,
  consumer: Party,
  window: PriceWindow,
  policies: { producer: Policy; consumer: Policy },
  maxRounds = 5,
): Promise<NegotiationResult> {
  const offers: Offer[] = [];
  if (!window.viable) {
    return { agreed: false, priceCt: null, offers, reason: "No price works for both sides: floor is above ceiling." };
  }
  const lastOf = (role: Role) => [...offers].reverse().find((o) => o.from === role)?.priceCt;

  for (let round = 1; round <= maxRounds; round++) {
    for (const self of [producer, consumer]) {
      const other: Role = self.role === "producer" ? "consumer" : "producer";
      const proposal = await policies[self.role]({ self, window, history: offers, round, maxRounds });
      const previousOwn = lastOf(self.role);
      const priceCt = guard(proposal.priceCt, self, window, previousOwn);
      offers.push({
        round,
        from: self.role,
        priceCt,
        message: proposal.message,
        reason: proposal.reason,
        concessionCt: previousOwn === undefined ? null : round2(Math.abs(previousOwn - priceCt)),
        adjusted: priceCt !== round2(proposal.priceCt),
        source: proposal.source,
      });

      // Deal when the offers meet: accept the other side's standing offer.
      const otherPrice = lastOf(other);
      if (otherPrice !== undefined) {
        const meets = self.role === "consumer" ? priceCt >= otherPrice : priceCt <= otherPrice;
        if (meets) {
          return { agreed: true, priceCt: otherPrice, offers, reason: `${self.name} accepted ${otherPrice} ct/kWh.` };
        }
      }
    }
  }
  return { agreed: false, priceCt: null, offers, reason: `No agreement after ${maxRounds} rounds.` };
}

/** Deterministic fallback: open at the edge of the window and concede linearly towards the private limit. */
export const ruleBasedPolicy: Policy = async ({ self, window, round, maxRounds }) => {
  const start = self.role === "producer" ? window.ceilingCt : window.floorCt;
  const t = maxRounds <= 1 ? 1 : (round - 1) / (maxRounds - 1);
  const priceCt = start + (self.limitCt - start) * t;
  // No number in the message: the protocol may still clamp the price, and the price is shown separately.
  return {
    priceCt,
    message: self.role === "producer" ? "Here is my next ask." : "Here is my next bid.",
    reason: round === 1 ? "Opens at the edge of the public price window." : "Concedes an equal step towards its own limit each round.",
    source: { kind: "rules" },
  };
};
