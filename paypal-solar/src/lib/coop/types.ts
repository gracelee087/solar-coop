// Operator model (§ 42c EnWG energy sharing run by a cooperative): several producer households feed PV into one
// pool, consumer households take their static share of it, the operator bills consumers and pays producers.
// Meter values are integer watt-hours (Wh) per 15-minute interval.

export type Role = "producer" | "consumer";

export interface Participant {
  id: string;
  name: string;
  role: Role;
  /** Payment account (PayPal sandbox e-mail in this prototype). Never placed in a payment memo with meter data. */
  email: string;
}

/** A PV system; its feed-in is the net export after the owner's own consumption (behind the meter). */
export interface Asset {
  id: string;
  ownerId: string;
  kWp: number;
}

export interface CoopGroup {
  id: string;
  participants: Participant[];
  assets: Asset[];
  /** Static allocation key per consumer id: share of the pooled feed-in offered in each interval, sum ≤ 1. */
  keys: Record<string, number>;
  /** Price per shared kWh billed to consumers (net, ct/kWh). */
  priceCt: number;
  /** Operator fee kept per shared kWh (ct/kWh); producers receive priceCt − operatorFeeCt. */
  operatorFeeCt: number;
}

export interface MeterInterval {
  /** ISO start time, Europe/Berlin local time with offset. */
  start: string;
  /** Net feed-in per producer id. */
  feedInWh: Record<string, number>;
  /** Consumption per consumer id. */
  consumptionWh: Record<string, number>;
}

export interface CoopAllocation {
  start: string;
  /** Energy each consumer took from the pool. */
  receivedWh: Record<string, number>;
  /** Shared energy credited to each producer (its part of what consumers took). */
  soldWh: Record<string, number>;
  /** Feed-in nobody in the group took, per producer (goes to the direct marketer / grid). */
  surplusWh: Record<string, number>;
}

export interface CoopMonth {
  period: string;
  receivedWh: Record<string, number>;
  consumptionWh: Record<string, number>;
  soldWh: Record<string, number>;
  feedInWh: Record<string, number>;
  surplusWh: Record<string, number>;
}

export interface ConsumerStatement {
  statementId: string;
  participantId: string;
  period: string;
  receivedWh: number;
  priceCt: number;
  amountCents: number;
}

export interface ProducerStatement {
  statementId: string;
  participantId: string;
  period: string;
  soldWh: number;
  payoutCt: number;
  amountCents: number;
}

export interface Settlement {
  groupId: string;
  period: string;
  consumers: ConsumerStatement[];
  producers: ProducerStatement[];
  /** Billed minus paid out: the operator's fee plus rounding. Never negative. */
  operatorRetainedCents: number;
}
