import type { HouseTone } from "../../lib/coop/house-status";

/** Status colours shared by the map and the per-house chart. `none` = not calculated yet (rehearsal preview). */
export const TONE: Record<HouseTone | "none", { fill: string; stroke: string; label: string }> = {
  green: { fill: "#e3f3ea", stroke: "#0f7a55", label: "Reconciled" },
  amber: { fill: "#fdf0d7", stroke: "#b26a00", label: "Pending" },
  red: { fill: "#fbe3e1", stroke: "#c62f2f", label: "Settlement problem" },
  none: { fill: "#f1f4f6", stroke: "#8a9ba6", label: "Not calculated yet" },
};
