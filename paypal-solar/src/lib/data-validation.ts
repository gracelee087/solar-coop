import type { H25June, PvgisJune } from "./real-data";
import type { Interval, SharingGroup } from "./types";

/** Reject missing values before coercion (Number(null) and Number("") would hide a gap as zero). */
export function requireNonnegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}: expected a finite, non-negative number`);
  }
}

function requireWh(value: unknown, label: string): asserts value is number {
  requireNonnegative(value, label);
  if (!Number.isSafeInteger(value)) throw new Error(`${label}: expected safe integer Wh`);
}

export function validateGroup(group: SharingGroup): void {
  requireNonnegative(group.producer.kWp, "producer kWp");
  requireNonnegative(group.producer.annualKWh, "producer annual kWh");
  const ids = new Set([group.producer.id]);
  let sum = 0;
  for (const h of group.households) {
    if (!h.id || ids.has(h.id)) throw new Error(`Duplicate or missing household id: ${h.id}`);
    ids.add(h.id);
    requireNonnegative(h.annualKWh, `${h.id} annual kWh`);
    requireNonnegative(h.key, `${h.id} allocation key`);
    if (h.key > 1) throw new Error(`${h.id} allocation key must be at most 1`);
    sum += h.key;
  }
  if (!Number.isFinite(sum) || sum > 1 + 1e-9) throw new Error(`Allocation keys must sum to at most 1 (got ${sum})`);
}

/** The converter needs every UTC hour of one June; repeated/missing keys must not be lost in a Map. */
export function validatePvgisJune(pv: PvgisJune, expectedYear?: number): void {
  if (!Array.isArray(pv?.hours) || pv.hours.length !== 720) {
    throw new Error(`PVGIS: expected 720 June hours, got ${pv?.hours?.length ?? "missing"}`);
  }
  const first = pv.hours[0]?.utc;
  const year = expectedYear ?? (typeof first === "string" ? Number(first.slice(0, 4)) : NaN);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error("PVGIS: invalid weather year");
  const seen = new Set<string>();
  for (const [i, hour] of pv.hours.entries()) {
    const utc = hour?.utc;
    if (seen.has(utc)) throw new Error(`PVGIS: duplicate timestamp ${utc}`);
    seen.add(utc);
    const day = String(Math.floor(i / 24) + 1).padStart(2, "0");
    const hh = String(i % 24).padStart(2, "0");
    const expected = `${year}06${day}:${hh}10`;
    if (utc !== expected) throw new Error(`PVGIS: expected ${expected}, got ${utc ?? "missing"} (gap, order or period mismatch)`);
    requireNonnegative(hour?.w, `PVGIS ${utc} W/kWp`);
  }
}

export function validateH25June(h25: H25June): void {
  for (const type of ["WT", "SA", "FT"] as const) {
    const values = h25?.profile?.[type];
    if (!Array.isArray(values) || values.length !== 96) throw new Error(`H25 ${type}: expected 96 quarter-hours`);
    for (let q = 0; q < 96; q++) requireNonnegative(values[q], `H25 ${type} quarter-hour ${q}`);
  }
}

/** Value checks also apply to callers that bypass the profile converter. Explicit zero is valid. */
export function validateInterval(group: SharingGroup, iv: Interval): void {
  requireWh(iv?.generationWh, `${iv?.start} generationWh`);
  requireWh(iv?.selfUseWh, `${iv?.start} selfUseWh`);
  if (iv.selfUseWh > iv.generationWh) throw new Error(`${iv.start}: self-use exceeds generation`);
  for (const h of group.households) requireWh(iv.loadWh?.[h.id], `${iv.start} ${h.id} loadWh`);
}

/** Fixed demo period: June 2026 in Europe/Berlin (CEST throughout this month). */
export function validateJuneIntervals(group: SharingGroup, intervals: Interval[]): void {
  validateGroup(group);
  if (!Array.isArray(intervals) || intervals.length !== 30 * 96) throw new Error("June 2026: expected 2,880 quarter-hours");
  const start = Date.parse("2026-06-01T00:00:00+02:00");
  for (const [i, iv] of intervals.entries()) {
    const expected = start + i * 15 * 60 * 1000;
    // Require an explicit time-zone offset so parsing does not depend on the host's local time zone.
    if (typeof iv?.start !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(iv.start) || Date.parse(iv.start) !== expected) {
      throw new Error(`June 2026: expected interval ${new Date(expected).toISOString()}, got ${iv?.start ?? "missing"} (gap, duplicate or period mismatch)`);
    }
    validateInterval(group, iv);
  }
}
