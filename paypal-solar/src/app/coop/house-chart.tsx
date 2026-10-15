"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GroupMedians, HouseStatus } from "@/lib/coop/house-status";
import { TONE } from "./tone";
import styles from "./workbench.module.css";

type Row = HouseStatus & { value: number };

/** Saved per-household values; bar colour = the same status as the map. */
export default function HouseChart({ houses, medians, selected, onSelect }: {
  houses: HouseStatus[];
  medians: GroupMedians;
  selected?: string;
  onSelect: (draftId: string) => void;
}) {
  const [unit, setUnit] = useState<"kWh" | "eur">("kWh");
  const rows: Row[] = houses.map((h) => ({ ...h, value: unit === "kWh" ? h.kWh : h.eur }));
  const fmt = (v: number) => (unit === "kWh" ? `${v.toFixed(1)} kWh` : `€${v.toFixed(2)}`);
  const segment = (kind: "bill" | "payout") => {
    const group = rows.filter((r) => r.kind === kind);
    return group.length ? { ids: [group[0].participantId, group.at(-1)!.participantId], y: medians[kind][unit] } : null;
  };
  const lines = [segment("bill"), segment("payout")];
  return (
    <div className={styles.chartWrap}>
      <div className={styles.chartTools}>
        <div className={styles.toggle} role="group" aria-label="Chart unit">
          <button aria-pressed={unit === "kWh"} onClick={() => setUnit("kWh")}>kWh</button>
          <button aria-pressed={unit === "eur"} onClick={() => setUnit("eur")}>€</button>
        </div>
        <span>
          <i className={styles.medianKey} /> Median · consumers {fmt(medians.bill[unit])} · producers {fmt(medians.payout[unit])}
        </span>
      </div>
      <div className={styles.chartBox}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#e7edef" />
            <XAxis dataKey="participantId" fontSize={11} tickLine={false} interval={0} />
            <YAxis fontSize={11} width={44} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: "#edf5ff" }}
              formatter={(v) => fmt(Number(v))}
              labelFormatter={(_, p) => {
                const r = p?.[0]?.payload as Row | undefined;
                return r ? `${r.name} · ${r.reason}${r.outlier ? ` · ${r.outlierReason}` : ""}` : "";
              }}
            />
            <Bar
              dataKey="value"
              name={unit === "kWh" ? "Energy" : "Amount"}
              isAnimationActive={false}
              cursor="pointer"
              radius={[4, 4, 0, 0]}
              onClick={(d) => {
                const id = (d as { payload?: Row }).payload?.draftId;
                if (id) onSelect(id);
              }}
            >
              {rows.map((r) => (
                <Cell
                  key={r.draftId}
                  fill={TONE[r.tone].stroke}
                  fillOpacity={r.draftId === selected ? 1 : 0.72}
                  stroke={r.draftId === selected ? "#0068db" : r.outlier ? "#162f40" : "none"}
                  strokeWidth={r.draftId === selected || r.outlier ? 2.5 : 0}
                  strokeDasharray={r.outlier ? "5 3" : undefined}
                />
              ))}
              <LabelList dataKey="outlier" position="top" formatter={(v) => (v ? "!" : "")} fontSize={14} fontWeight={800} fill="#162f40" />
            </Bar>
            {lines.map((l, i) =>
              l ? (
                <ReferenceLine
                  key={i}
                  segment={[{ x: l.ids[0], y: l.y }, { x: l.ids[1], y: l.y }]}
                  stroke="#162f40"
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                />
              ) : null,
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
