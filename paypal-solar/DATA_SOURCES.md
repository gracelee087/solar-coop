# Data sources and assumptions

This demo settles one month of neighbourhood solar sharing under German Energy Sharing (§ 42c EnWG) in
Frankfurt am Main. **No smart-meter readings are used.** Everything below is either a published price or a
public profile, and the 15-minute values are modelled from those profiles.

## What is measured, what is modelled

| Data | Kind | Source |
|---|---|---|
| PV output | Modelled from satellite weather data (hourly) | PVGIS 5.3, European Commission JRC |
| Household consumption | Standard load profile, not a real household | BDEW H25 |
| Prices, fees, taxes | Published 2026 tariffs and statutory values | see table below |
| Neighbours, roof size, contracts | Invented demo group | `src/lib/demo-group.ts` |

## PV generation: PVGIS

- API: PVGIS 5.3 `seriescalc`, Frankfurt 50.11 N, 8.68 E, south-facing, 35° tilt, building-mounted, 14 % system loss.
  The exact request URL is stored in `src/data/pvgis-frankfurt-2023-06.json`.
- Output: hourly average power in W per kWp, timestamps in UTC. June 2023 gives 147.0 kWh per kWp.
- Attribution: "PVGIS © European Communities, 2001-2026". The file is committed.
- **Year mapping:** 2023 is the latest year in this PVGIS dataset. Its June weather is mapped day by day onto
  June 2026, the billing month of the demo. Weekdays and holidays come from 2026, the weather comes from 2023.
- **Hours to quarter-hours:** each hourly value is split into four equal 15-minute values. Real output changes
  within an hour (clouds), so per-interval values are smoothed. Hourly energy is preserved before integer-Wh
  rounding and month-boundary handling.
- Times are converted from UTC to CEST (UTC+2).
- At the month boundary, June 1 00:00–01:45 CEST uses an explicit zero-output assumption for May 31
  22:00/23:00 UTC, which is not in the stored June source. All later early hours use the preceding June UTC day.
  Missing June readings are errors, never substituted with zero.

## Data checks before settlement

- Each PVGIS June must contain exactly 720 unique, ordered hourly timestamps for the expected weather year,
  with finite, non-negative numeric values. Settlement uses 2023; the expectation requires all of 2005–2022.
- H25 requires WT, SA and FT profiles with 96 finite, non-negative numbers each. Empty Excel cells and
  numeric strings are rejected before conversion; explicit numeric zero is valid.
- The converted month must contain all 2,880 consecutive quarter-hours from June 1 to July 1, 2026 CEST.
  Every household reading is required. Generation, self-use and loads must be non-negative safe integer Wh,
  and self-use cannot exceed generation. Allocation keys must be finite, non-negative and sum to at most one.
- Invalid data stops before settlement. Non-finite or non-positive billing quantities, prices and amounts
  also stop before any PayPal or Gemini call. Zero shared energy is valid input data but creates no invoice.

## Household consumption: BDEW H25

- Source: BDEW representative profiles H25 (XLSX, sheet "H25"), 96 quarter-hours per day type
  (working day, Saturday, Sunday/holiday) per month, normalised to 1,000,000 kWh per year.
- Scaled to each household's annual consumption with the published H25 dynamisation polynomial for the day of the year.
- Day types for June 2026 in Hesse: Sundays and Corpus Christi (4 June) use the holiday profile, Saturdays the Saturday profile.
- **Licence:** no licence text was found for the file, so it is not committed. `npm run fetch-data` downloads it.
- A standard profile is an average of many households. A real household's 15-minute load is far more spiky, so real
  sharing shares can differ from the demo.
- Annual consumption of the demo households (typical values, not measurements): neighbours 2,700 / 3,800 / 3,500 kWh
  (Stromspiegel 2025, houses without electric water heating: 2, 4 and 3 persons); producer's own household 3,700 kWh
  (co2online 2026, PV households with 3–4 persons).

## Allocation

- Static allocation key ("statische Aufteilung"): in every 15-minute interval each neighbour is offered a fixed share
  of the producer's feed-in (30 % / 30 % / 20 %) and takes at most its own consumption.
- The producer's household uses its own PV first. Only the remainder is fed in and can be shared.
- Energy offered but not used is surplus. In practice it goes to the direct marketer, and the demo does not price it.
- Dynamic allocation (redistributing unused shares) is not modelled.

## Prices (Frankfurt, 2026)

All values with links are in `src/lib/tariffs.ts`, each marked confirmed / partial / assumption and with the
validity stated in its source. Every source was opened and checked against the value on 2026-10-13.

| Parameter | Value | Source | Note |
|---|---|---|---|
| Default supply (Mainova "Strom Classic") | 38.78 ct/kWh gross; base fee 91.49 €/year gross (incl. grid base fee 34.98 €/year net) | Mainova mandatory disclosure, valid from 1 Jan 2026 | the neighbour's alternative |
| Grid fee (NRM) | 9.23 ct/kWh net | NRM price sheet, valid from 1 Jan 2026, row "Arbeitspreis ST", category "sonstiger Verbrauch" | charged on shared kWh too. The row does not say "household" or "net"; Mainova lists the same 9.230 ct/kWh as a net component |
| Concession fee | 2.39 ct/kWh net | Mainova disclosure | |
| Levies: KWKG, offshore (§ 17f(5) EnWG), special grid-use surcharge ("Aufschlag für besondere Netznutzung") | 0.446 / 0.941 / 1.559 ct/kWh net | Mainova disclosure, valid from 1 Jan 2026 | |
| Electricity tax | 2.05 ct/kWh net | § 3 StromStG (20.50 €/MWh; no date on the page) | on by default. An exemption within 4.5 km is debated, so it is a setting |
| VAT | 19 % | | on the regulated components |
| EEG feed-in tariff | 7.70 ct/kWh | Bundesnetzagentur (building system, commissioning 1 Aug–31 Dec 2026) | the producer's alternative (see below) |
| Platform fee | 1.0 ct/kWh, paid by the producer (demo assumption) | solarserver.de article of 2 Sep 2026 on "Mitmachstrom" (secondary) | partial: the platform operator WeShareEnergy charges 1 ct per traded kWh without saying who pays; the Mitmachstrom margin of 1 ct applies only to the part of the price above the EEG tariff |
| PayPal fee | 2.99 % + 0.39 € per payment, paid by the producer | PayPal Germany business fees (last updated 7 Sep 2026) | partial: no separate rate for invoices is listed, so the commercial rate is assumed |
| Smart-meter user share | 30 € gross per year (2.50 € per month) | § 30(3) MsbG, from 1 Jan 2025 | optional installation: the user's half of a 60 € gross cap; a BNetzA determination may replace the caps (§ 30(6)). Counted as the neighbour's cost of joining |
| Residual supply price | not modelled separately | Bundesnetzagentur consumer page (https://www.bundesnetzagentur.de/1107632) | suppliers, including the default supplier, may charge more for a residual supply contract; shown as unverified |

- **Feed-in tariff period:** 7.70 ct/kWh is the published rate for small systems (≤ 10 kW part, partial feed-in)
  **commissioned August to December 2026**. The demo assumes such a new system while billing June 2026, so the
  tariff and the billing month do not line up exactly. Older systems have higher tariffs, which narrows the price window.
- The sharing price carries no VAT: the producer is assumed to be a small business under § 19 UStG.
- These are inputs to a demo, not tax or legal advice.

## Price window

For each neighbour and month the app searches, in 0.01 ct steps, for every price at which **both sides are at
least 1 cent better off** after rounding to cents:

- the producer, compared with the feed-in tariff, after the platform fee and the PayPal fee;
- the neighbour, compared with default supply, after the regulated costs and the smart-meter share.

If no such price exists (for example, when too little was shared to cover the smart-meter share), there is no deal
that month. The agents negotiate only inside this window.
