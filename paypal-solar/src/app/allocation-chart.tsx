"use client";

import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartPoint } from "@/lib/dashboard";

const HOUSE_COLOURS = ["#2563eb", "#16a34a", "#9333ea", "#0891b2"];

/** One modelled day: the producer's own use, each neighbour's share and the unused surplus stack up to the generation line. */
export default function AllocationChart({ days, households }: { days: { date: string; points: ChartPoint[] }[]; households: { id: string; name: string }[] }) {
  const [day, setDay] = useState(Math.min(14, days.length - 1));
  const rows = days[day].points.map((p) => ({ t: p.t, generation: p.generation, selfUse: p.selfUse, surplus: p.surplus, ...p.shared }));
  return (
    <div>
      <label className="flex items-center gap-3 text-sm">
        <span>Day</span>
        <input type="range" min={0} max={days.length - 1} value={day} onChange={(e) => setDay(Number(e.target.value))} className="w-60" />
        <span className="font-mono">{days[day].date}</span>
      </label>
      <div className="h-80 mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="t" interval={11} fontSize={12} />
            <YAxis unit=" kW" fontSize={12} width={60} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(2)} kW`} />
            <Legend />
            <Area isAnimationActive={false} type="stepAfter" dataKey="selfUse" name="Producer's own use" stackId="g" stroke="#f59e0b" fill="#fcd34d" />
            {households.map((h, i) => (
              <Area key={h.id} isAnimationActive={false} type="stepAfter" dataKey={h.id} name={`Shared with ${h.name}`} stackId="g" stroke={HOUSE_COLOURS[i % 4]} fill={HOUSE_COLOURS[i % 4]} fillOpacity={0.5} />
            ))}
            <Area isAnimationActive={false} type="stepAfter" dataKey="surplus" name="Unused surplus (fed in)" stackId="g" stroke="#9ca3af" fill="#e5e7eb" />
            <Line isAnimationActive={false} type="stepAfter" dataKey="generation" name="Generation" stroke="#111827" dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
