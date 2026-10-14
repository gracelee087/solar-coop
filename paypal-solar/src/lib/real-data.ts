import type { Interval, SharingGroup } from "./types";
import { validateGroup, validateH25June, validateJuneIntervals, validatePvgisJune } from "./data-validation";

export interface PvgisJune {
  attribution: string;
  /** Hourly average output in W per kWp; `utc` is "YYYYMMDD:HH10". */
  hours: { utc: string; w: number }[];
}

export interface H25June {
  /** 96 quarter-hour values (kWh, normalised to 1,000,000 kWh/year) per day type. */
  profile: Record<"WT" | "SA" | "FT", number[]>;
}

/** Hesse public holidays in June 2026: Corpus Christi (Easter 5 April + 60 days). */
const HOLIDAYS_JUNE_2026 = new Set([4]);

/** BDEW dynamisation factor for H25, t = day of year (1 = 1 January). */
export function h25Dynamisation(t: number): number {
  return -3.92e-10 * t ** 4 + 3.2e-7 * t ** 3 - 7.02e-5 * t ** 2 + 2.1e-3 * t + 1.24;
}

function dayType(date: Date): "WT" | "SA" | "FT" {
  const dow = date.getUTCDay();
  if (dow === 0 || HOLIDAYS_JUNE_2026.has(date.getUTCDate())) return "FT";
  return dow === 6 ? "SA" : "WT";
}

/**
 * June 2026 in 15-minute intervals from real profiles: PV output from PVGIS (weather of June of the PVGIS year,
 * mapped day by day) and household loads from the BDEW H25 standard load profile scaled to each annual consumption.
 * Times are CEST (UTC+2). The producer's household uses its own PV first; only the rest is fed in and shared.
 */
export function buildRealJune(group: SharingGroup, pv: PvgisJune, h25: H25June): Interval[] {
  validateGroup(group);
  validatePvgisJune(pv);
  validateH25June(h25);
  const pvByUtc = new Map(pv.hours.map((h) => [h.utc.slice(6, 8) + h.utc.slice(9, 11), h.w])); // "DDHH" → W/kWp
  const dayOfYearJune1 = 152; // 2026 is not a leap year
  const scale = (annualKWh: number, dyn: number) => (annualKWh / 1_000_000) * dyn * 1000; // kWh → Wh
  const intervals: Interval[] = [];

  for (let day = 1; day <= 30; day++) {
    const date = new Date(Date.UTC(2026, 5, day));
    const dt = dayType(date);
    const dyn = h25Dynamisation(dayOfYearJune1 + day - 1);
    for (let q = 0; q < 96; q++) {
      const localHour = Math.floor(q / 4);
      // CEST → UTC. Before 02:00, use the preceding UTC day; only June 1 needs a May boundary assumption.
      const utcHour = localHour - 2;
      const utcDay = utcHour >= 0 ? day : day - 1;
      const key = `${String(utcDay).padStart(2, "0")}${String((utcHour + 24) % 24).padStart(2, "0")}`;
      // No May 31 source is stored. Explicit demo assumption: its 22:00/23:00 UTC PV output is zero.
      // All hours inside June were validated above; a missing value is never replaced with zero.
      const watts = utcDay === 0 ? 0 : pvByUtc.get(key)!;
      const generationWh = Math.round(watts * group.producer.kWp * 0.25);

      const loadWh: Record<string, number> = {};
      for (const h of group.households) loadWh[h.id] = Math.round(h25.profile[dt][q] * scale(h.annualKWh, dyn));
      const producerLoad = Math.round(h25.profile[dt][q] * scale(group.producer.annualKWh, dyn));

      const hh = String(localHour).padStart(2, "0");
      const mm = String((q % 4) * 15).padStart(2, "0");
      intervals.push({
        start: `2026-06-${String(day).padStart(2, "0")}T${hh}:${mm}:00+02:00`,
        generationWh,
        selfUseWh: Math.min(generationWh, producerLoad),
        loadWh,
      });
    }
  }
  validateJuneIntervals(group, intervals);
  return intervals;
}
