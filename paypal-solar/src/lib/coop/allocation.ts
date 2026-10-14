import type { CoopAllocation, CoopGroup, CoopMonth, MeterInterval } from "./types";

export const producersOf = (g: CoopGroup) => g.participants.filter((p) => p.role === "producer");
export const consumersOf = (g: CoopGroup) => g.participants.filter((p) => p.role === "consumer");

export function validateCoopGroup(g: CoopGroup): void {
  const ids = new Set<string>();
  for (const p of g.participants) {
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(p.id)) throw new Error(`Invalid participant id: ${p.id}`);
    if (ids.has(p.id)) throw new Error(`Duplicate participant id: ${p.id}`);
    ids.add(p.id);
  }
  const producers = producersOf(g);
  const consumers = consumersOf(g);
  if (producers.length === 0 || consumers.length === 0) throw new Error("A group needs at least one producer and one consumer");
  for (const a of g.assets) {
    if (!producers.some((p) => p.id === a.ownerId)) throw new Error(`Asset ${a.id} is not owned by a producer`);
    if (!(Number.isFinite(a.kWp) && a.kWp > 0)) throw new Error(`Asset ${a.id} needs a positive kWp`);
  }
  for (const p of producers) if (!g.assets.some((a) => a.ownerId === p.id)) throw new Error(`Producer ${p.id} has no PV asset`);
  let sum = 0;
  for (const c of consumers) {
    const k = g.keys[c.id];
    if (!(Number.isFinite(k) && k >= 0 && k <= 1)) throw new Error(`Consumer ${c.id} needs an allocation key in 0..1`);
    sum += k;
  }
  if (Object.keys(g.keys).some((id) => !consumers.some((c) => c.id === id))) throw new Error("Allocation key for a non-consumer");
  if (sum > 1 + 1e-9) throw new Error(`Allocation keys sum to ${sum}, above 1`);
  if (!(Number.isFinite(g.priceCt) && g.priceCt > 0)) throw new Error("Price must be positive");
  if (!(Number.isFinite(g.operatorFeeCt) && g.operatorFeeCt >= 0 && g.operatorFeeCt < g.priceCt)) {
    throw new Error("Operator fee must be in 0..price");
  }
}

function wh(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label}: Wh must be a non-negative integer`);
  return value as number;
}

/**
 * Split `total` Wh over producers in proportion to their feed-in, in whole Wh (largest remainder, ties in
 * producer order), so the parts add up exactly and no producer is credited more than it fed in.
 */
function splitByFeedIn(total: number, feedIn: [string, number][], pool: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (total === 0) {
    for (const [id] of feedIn) out[id] = 0;
    return out;
  }
  const parts = feedIn.map(([id, f], i) => {
    const exact = (total * f) / pool;
    return { id, i, base: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = total - parts.reduce((s, p) => s + p.base, 0);
  for (const p of [...parts].sort((a, b) => b.rest - a.rest || a.i - b.i)) {
    if (left === 0) break;
    p.base += 1;
    left -= 1;
  }
  for (const p of parts) out[p.id] = p.base;
  return out;
}

/**
 * Static allocation over a pool: each consumer is offered its key's share of the pooled feed-in and takes at most
 * what it consumes. What consumers took is credited to producers in proportion to their feed-in; the rest is
 * each producer's surplus.
 */
export function allocateCoopInterval(g: CoopGroup, iv: MeterInterval): CoopAllocation {
  const producers = producersOf(g);
  const consumers = consumersOf(g);
  const feedIn = producers.map((p) => [p.id, wh(iv.feedInWh[p.id], `${iv.start} ${p.id} feed-in`)] as [string, number]);
  const pool = feedIn.reduce((s, [, f]) => s + f, 0);
  const receivedWh: Record<string, number> = {};
  let shared = 0;
  for (const c of consumers) {
    const load = wh(iv.consumptionWh[c.id], `${iv.start} ${c.id} consumption`);
    const take = Math.min(Math.floor(pool * g.keys[c.id]), load);
    receivedWh[c.id] = take;
    shared += take;
  }
  if (shared > pool) throw new Error(`${iv.start}: allocated more than the pool`);
  const soldWh = splitByFeedIn(shared, feedIn, pool);
  const surplusWh: Record<string, number> = {};
  for (const [id, f] of feedIn) {
    surplusWh[id] = f - soldWh[id];
    if (surplusWh[id] < 0) throw new Error(`${iv.start}: producer ${id} credited above its feed-in`);
  }
  return { start: iv.start, receivedWh, soldWh, surplusWh };
}

export function aggregateCoopMonth(g: CoopGroup, period: string, intervals: MeterInterval[]): CoopMonth {
  validateCoopGroup(g);
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period: ${period}`);
  const zero = (ps: { id: string }[]) => Object.fromEntries(ps.map((p) => [p.id, 0]));
  const producers = producersOf(g);
  const consumers = consumersOf(g);
  const m: CoopMonth = {
    period,
    receivedWh: zero(consumers),
    consumptionWh: zero(consumers),
    soldWh: zero(producers),
    feedInWh: zero(producers),
    surplusWh: zero(producers),
  };
  for (const iv of intervals) {
    if (!iv.start.startsWith(period)) throw new Error(`Interval ${iv.start} is outside ${period}`);
    const a = allocateCoopInterval(g, iv);
    for (const c of consumers) {
      m.receivedWh[c.id] += a.receivedWh[c.id];
      m.consumptionWh[c.id] += iv.consumptionWh[c.id];
    }
    for (const p of producers) {
      m.soldWh[p.id] += a.soldWh[p.id];
      m.feedInWh[p.id] += iv.feedInWh[p.id];
      m.surplusWh[p.id] += a.surplusWh[p.id];
    }
  }
  return m;
}
