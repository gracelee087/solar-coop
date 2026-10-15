/**
 * Illustrative positions for the ten fictional households: points on street centre lines in Frankfurt-Bornheim
 * (snapped from a ~120 m grid to OpenStreetMap street geometry, fetched once on 2026-10-15). Not addresses or
 * buildings. All points lie inside the NRM grid-area approximation in src/data/grid-area-frankfurt.json.
 */
export const HOUSE_SLOTS: [number, number][] = [
  [50.12447, 8.70555],
  [50.12413, 8.70776],
  [50.1244, 8.70905],
  [50.12563, 8.7038],
  [50.12521, 8.706],
  [50.12553, 8.70735],
  [50.12544, 8.70904],
  [50.12665, 8.70389],
  [50.12661, 8.70562],
  [50.12668, 8.70746],
];

/** Drawn meeting point for the shared pool. The allocation is a pool split by key, not a physical line. */
export const POOL_POINT: [number, number] = [50.1255, 8.7065];
