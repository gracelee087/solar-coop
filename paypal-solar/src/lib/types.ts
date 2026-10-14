// Meter values are integer watt-hours (Wh) per 15-minute interval, like smart-meter readings.

export interface Household {
  id: string;
  name: string;
  /** Share of the producer's feed-in offered to this household (static allocation key), 0..1. */
  key: number;
}

export interface SharingGroup {
  /** The producer's own household consumes its PV first; only the remaining feed-in can be shared. */
  producer: { id: string; name: string; kWp: number; annualKWh: number };
  households: (Household & { annualKWh: number })[];
}

export interface Interval {
  /** ISO start time, Europe/Berlin local time with offset. */
  start: string;
  generationWh: number;
  /** Producer's own consumption covered by its PV in this interval (behind the meter, never shared). */
  selfUseWh: number;
  /** Consumption per household id. */
  loadWh: Record<string, number>;
}

export interface IntervalAllocation {
  start: string;
  generationWh: number;
  selfUseWh: number;
  sharedWh: Record<string, number>;
  surplusWh: number;
}
