/**
 * Limits for the live negotiation, which spends free-tier Gemini quota: one run at a time, a cooldown per caller
 * and a daily cap for everyone together. In memory only (one server process), so a restart resets it.
 */
export function makeLimiter(o: { now: () => number; cooldownMs: number; dailyCap: number }) {
  let running = false;
  const lastByCaller = new Map<string, number>();
  let day = "";
  let used = 0;
  return {
    acquire(caller: string): { ok: true } | { ok: false; reason: string; retryAfterSec: number } {
      const t = o.now();
      const today = new Date(t).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (running) return { ok: false, reason: "Another live negotiation is running.", retryAfterSec: 30 };
      if (used >= o.dailyCap) {
        const midnight = Date.parse(`${today}T00:00:00Z`) + 86_400_000;
        return { ok: false, reason: `Daily limit of ${o.dailyCap} live negotiations reached.`, retryAfterSec: Math.ceil((midnight - t) / 1000) };
      }
      const last = lastByCaller.get(caller);
      if (last !== undefined && t - last < o.cooldownMs) {
        return { ok: false, reason: "Please wait before starting another live negotiation.", retryAfterSec: Math.ceil((o.cooldownMs - (t - last)) / 1000) };
      }
      running = true;
      used += 1;
      lastByCaller.set(caller, t);
      return { ok: true };
    },
    release() {
      running = false;
    },
  };
}
