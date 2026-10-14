// Downloads the real-world profiles used by the demo into src/data/.
//  - PVGIS hourly PV output for Frankfurt (free use with attribution) → committed.
//  - BDEW H25 household standard load profile (no licence text found) → downloaded at build time, git-ignored.
import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireNonnegative, validateH25June, validatePvgisJune } from "../src/lib/data-validation";
import type { H25June } from "../src/lib/real-data";

const OUT = path.join(process.cwd(), "src", "data");
const YEAR = 2023; // latest year available in PVGIS 5.3 (SARAH3: 2005–2023); the month that is settled
const pvgisUrl = (from: number, to: number) =>
  `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat=50.11&lon=8.68&startyear=${from}&endyear=${to}` +
  "&pvcalculation=1&peakpower=1&loss=14&angle=35&aspect=0&mountingplace=building&outputformat=json";
const PVGIS_URL = pvgisUrl(YEAR, YEAR);
// Earlier Junes for the expected (pre-supply) estimate; 2023 is excluded because it is the month compared against.
const HISTORY = { from: 2005, to: 2022 };
const H25_URL =
  "https://www.bdew.de/media/documents/Kopie_von_Repr%C3%A4sentative_Profile_BDEW_H25_G25_L25_P25_S25_Ver%C3%B6ffentlichung.xlsx";

async function fetchPvgis() {
  const res = await fetch(PVGIS_URL);
  if (!res.ok) throw new Error(`PVGIS ${res.status}`);
  const data = (await res.json()) as { outputs: { hourly: { time: string; P: number }[] } };
  // time "YYYYMMDD:HH10" is UTC; P is W for a 1 kWp system, averaged over that hour.
  const june = data.outputs.hourly.filter((h) => h.time.startsWith(`${YEAR}06`));
  const hours = june.map((h) => ({ utc: h.time, w: h.P }));
  validatePvgisJune({ attribution: "PVGIS", hours }, YEAR);
  await writeFile(
    path.join(OUT, `pvgis-frankfurt-${YEAR}-06.json`),
    JSON.stringify({
      source: PVGIS_URL,
      attribution: "PVGIS © European Communities, 2001-2026",
      unit: "W per kWp, hourly average, UTC",
      setup: "Frankfurt 50.11N 8.68E, south, 35° tilt, building-mounted, 14% system loss",
      hours,
    }),
  );
  console.log(`PVGIS: ${june.length} hours, ${(june.reduce((s, h) => s + h.P, 0) / 1000).toFixed(1)} kWh/kWp in June ${YEAR}`);
}

async function fetchH25() {
  const res = await fetch(H25_URL);
  if (!res.ok) throw new Error(`BDEW ${res.status}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  const ws = wb.getWorksheet("H25");
  if (!ws) throw new Error("sheet H25 not found");
  // Row 3: month start dates, row 4: day types (SA/FT/WT), rows 5..100: 96 quarter-hours. June = 6th triple of columns.
  const cols: Record<string, number> = {};
  ws.getRow(4).eachCell((cell, col) => {
    const month = new Date(ws.getRow(3).getCell(col).value as Date).getUTCMonth() + 1;
    if (month === 6) cols[String(cell.value)] = col;
  });
  const profile: Record<string, number[]> = {};
  for (const [dayType, col] of Object.entries(cols)) {
    profile[dayType] = Array.from({ length: 96 }, (_, q) => {
      const value = ws.getRow(5 + q).getCell(col).value;
      requireNonnegative(value, `BDEW H25 ${dayType} row ${5 + q}`);
      return value;
    });
  }
  if (Object.keys(profile).length !== 3) throw new Error(`expected SA/FT/WT columns for June, got ${Object.keys(profile)}`);
  validateH25June({ profile: profile as H25June["profile"] });
  await writeFile(
    path.join(OUT, "h25-june.json"),
    JSON.stringify({
      source: H25_URL,
      unit: "kWh per quarter-hour, normalised to 1,000,000 kWh/year, before dynamisation",
      dayTypes: { WT: "working day", SA: "Saturday", FT: "Sunday / public holiday" },
      profile,
    }),
  );
  console.log(`BDEW H25: June profiles ${Object.keys(profile).join(", ")}`);
}

async function fetchPvgisHistory() {
  const url = pvgisUrl(HISTORY.from, HISTORY.to);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PVGIS history ${res.status}`);
  const data = (await res.json()) as { outputs: { hourly: { time: string; P: number }[] } };
  const years: Record<string, { utc: string; w: number }[]> = {};
  for (let y = HISTORY.from; y <= HISTORY.to; y++) {
    years[y] = data.outputs.hourly.filter((h) => h.time.startsWith(`${y}06`)).map((h) => ({ utc: h.time, w: h.P }));
    validatePvgisJune({ attribution: "PVGIS", hours: years[y] }, y);
  }
  await writeFile(
    path.join(OUT, `pvgis-frankfurt-${HISTORY.from}-${HISTORY.to}-06.json`),
    JSON.stringify({
      source: url,
      attribution: "PVGIS © European Communities, 2001-2026",
      unit: "W per kWp, hourly average, UTC",
      setup: "Frankfurt 50.11N 8.68E, south, 35° tilt, building-mounted, 14% system loss",
      years,
    }),
  );
  const kWh = Object.values(years).map((h) => h.reduce((s, x) => s + x.w, 0) / 1000);
  console.log(`PVGIS history: June ${HISTORY.from}–${HISTORY.to}, ${(kWh.reduce((a, b) => a + b, 0) / kWh.length).toFixed(1)} kWh/kWp on average`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (!process.argv.includes("--h25-only")) {
    await fetchPvgis();
    await fetchPvgisHistory();
  }
  await fetchH25();
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
