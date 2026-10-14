import { consumersOf, producersOf, validateCoopGroup } from "./allocation";
import type { CoopGroup, MeterInterval } from "./types";

// There is no BNetzA standard exchange format for energy-sharing meter data yet, so the prototype reads a CSV:
// one row per 15-minute interval, one column per participant register, integer Wh.
//   start,H01_feed_in_wh,...,H04_consumption_wh,...

const QUARTER_MS = 15 * 60 * 1000;

export function csvHeader(g: CoopGroup): string[] {
  return [
    "start",
    ...producersOf(g).map((p) => `${p.id}_feed_in_wh`),
    ...consumersOf(g).map((c) => `${c.id}_consumption_wh`),
  ];
}

export function toMeterCsv(g: CoopGroup, intervals: MeterInterval[]): string {
  const rows = intervals.map((iv) =>
    [iv.start, ...producersOf(g).map((p) => iv.feedInWh[p.id]), ...consumersOf(g).map((c) => iv.consumptionWh[c.id])].join(","),
  );
  return [csvHeader(g).join(","), ...rows].join("\n") + "\n";
}

/**
 * Parses and validates one month: the header must list exactly the group's registers, every value must be a
 * non-negative integer, and the rows must cover the month from 00:00 on day 1 to 23:45 on the last day in
 * consecutive 15-minute steps (so a DST month has 92 or 100 quarter-hours that day, and no gaps are possible).
 */
export function parseMeterCsv(g: CoopGroup, period: string, text: string): MeterInterval[] {
  validateCoopGroup(g);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("Meter CSV has no data rows");
  const header = lines[0].split(",").map((s) => s.trim());
  const expected = csvHeader(g);
  if (header.join(",") !== expected.join(",")) throw new Error(`Meter CSV header must be: ${expected.join(",")}`);
  const producers = producersOf(g);
  const consumers = consumersOf(g);
  const out: MeterInterval[] = [];
  let prev: number | null = null;
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(",").map((s) => s.trim());
    const row = i + 2;
    if (cells.length !== expected.length) throw new Error(`Row ${row}: expected ${expected.length} columns`);
    const [start, ...values] = cells;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/.test(start) || !start.startsWith(period)) {
      throw new Error(`Row ${row}: start ${start} is not a timestamp in ${period}`);
    }
    const t = Date.parse(start);
    if (prev !== null && t - prev !== QUARTER_MS) throw new Error(`Row ${row}: not 15 minutes after the previous row`);
    prev = t;
    const nums = values.map((v, j) => {
      if (!/^\d+$/.test(v)) throw new Error(`Row ${row}, ${expected[j + 1]}: expected a non-negative integer, got "${v}"`);
      const n = Number(v);
      if (!Number.isSafeInteger(n)) throw new Error(`Row ${row}, ${expected[j + 1]}: value too large`);
      return n;
    });
    out.push({
      start,
      feedInWh: Object.fromEntries(producers.map((p, j) => [p.id, nums[j]])),
      consumptionWh: Object.fromEntries(consumers.map((c, j) => [c.id, nums[producers.length + j]])),
    });
  });
  const [y, m] = period.split("-").map(Number);
  const lastDay = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
  if (!out[0].start.startsWith(`${period}-01T00:00`)) throw new Error("Meter CSV must start at 00:00 on day 1");
  if (!out[out.length - 1].start.startsWith(`${period}-${lastDay}T23:45`)) throw new Error("Meter CSV must end at 23:45 on the last day");
  return out;
}
