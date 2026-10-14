import { mulberry32 } from "./rng";
import type { Interval, SharingGroup } from "./types";

/**
 * Simulated month of 15-minute meter data. Not real smart-meter data: a sine-shaped PV curve
 * scaled by a random daily weather factor, and households with a base load plus morning/evening peaks.
 * June is used so the whole month sits in CEST (+02:00) with no DST switch.
 */
export function simulateMonth(
  group: SharingGroup,
  opts: { year?: number; month?: number; seed?: number } = {},
): Interval[] {
  const { year = 2026, month = 6, seed = 42 } = opts;
  const rng = mulberry32(seed);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const sunrise = 5.0;
  const sunset = 21.5;
  const intervals: Interval[] = [];

  const profiles = Object.fromEntries(
    group.households.map((h) => [h.id, { baseW: 150 + rng() * 150, peakW: 600 + rng() * 900 }]),
  );

  for (let day = 1; day <= days; day++) {
    const weather = 0.25 + 0.75 * rng(); // 0.25 = overcast, 1 = clear sky
    for (let q = 0; q < 96; q++) {
      const hour = q / 4 + 0.125; // middle of the interval
      let pvW = 0;
      if (hour > sunrise && hour < sunset) {
        const x = (hour - sunrise) / (sunset - sunrise);
        pvW = group.producer.kWp * 1000 * 0.8 * Math.sin(Math.PI * x) * weather * (0.9 + 0.1 * rng());
      }
      const loadWh: Record<string, number> = {};
      for (const h of group.households) {
        const p = profiles[h.id];
        const morning = Math.exp(-((hour - 7.5) ** 2) / 1.5);
        const evening = Math.exp(-((hour - 19) ** 2) / 3);
        const w = p.baseW + p.peakW * (0.6 * morning + evening) * (0.7 + 0.6 * rng());
        loadWh[h.id] = Math.round(w / 4);
      }
      const hh = String(Math.floor(q / 4)).padStart(2, "0");
      const mm = String((q % 4) * 15).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      const mo = String(month).padStart(2, "0");
      intervals.push({
        start: `${year}-${mo}-${dd}T${hh}:${mm}:00+02:00`,
        generationWh: Math.round(pvW / 4),
        selfUseWh: 0, // the synthetic generator does not model the producer's own household
        loadWh,
      });
    }
  }
  return intervals;
}
