// Writes the sample meter CSV for the 10-household cooperative (src/data/coop-meter-2026-06.csv).
// Modelled, not metered: PV from PVGIS (Frankfurt, June 2023 weather) per producer's kWp, the producer's own
// consumption covered first; household loads from the BDEW H25 profile. Needs `npm run fetch-data` first (H25 file).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadRealJuneFrom } from "../src/lib/real-data-files";
import { consumersOf, producersOf } from "../src/lib/coop/allocation";
import { toMeterCsv, parseMeterCsv } from "../src/lib/coop/meter-csv";
import { sampleCoop } from "../src/lib/coop/sample-group";
import type { MeterInterval } from "../src/lib/coop/types";

const DATA = path.join(__dirname, "..", "src", "data");
const OUT = path.join(DATA, "coop-meter-2026-06.csv");
const g = sampleCoop;
const consumers = consumersOf(g);

// One modelled June per producer: buildRealJune gives its generation and self-use, plus every consumer's load.
const runs = producersOf(g).map((p) => {
  const kWp = g.assets.filter((a) => a.ownerId === p.id).reduce((s, a) => s + a.kWp, 0);
  return {
    id: p.id,
    intervals: loadRealJuneFrom(DATA, {
      producer: { id: p.id, name: p.name, kWp, annualKWh: g.annualKWh[p.id] },
      households: consumers.map((c) => ({ id: c.id, name: c.name, key: 0, annualKWh: g.annualKWh[c.id] })),
    }),
  };
});

const intervals: MeterInterval[] = runs[0].intervals.map((iv, i) => ({
  start: iv.start,
  feedInWh: Object.fromEntries(runs.map((r) => [r.id, r.intervals[i].generationWh - r.intervals[i].selfUseWh])),
  consumptionWh: iv.loadWh,
}));

const csv = toMeterCsv(g, intervals);
parseMeterCsv(g, "2026-06", csv); // never write a file the parser would reject
writeFileSync(OUT, csv);
console.log(`Wrote ${intervals.length} intervals to ${path.relative(process.cwd(), OUT)}`);
