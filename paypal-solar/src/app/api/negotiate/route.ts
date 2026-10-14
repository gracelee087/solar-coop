import { loadDashboardPageData } from "@/lib/dashboard-data";
import { demoConsumers, demoProducer } from "@/lib/demo-group";
import { geminiPolicy } from "@/lib/gemini-policy";
import { makeNegotiateHandler } from "@/lib/negotiate-handler";
import { negotiate } from "@/lib/negotiation";
import type { PriceWindow } from "@/lib/pricing";
import { makeLimiter } from "@/lib/rate-limit";

// Live negotiation preview. The private limits stay on the server; the result is never saved and does not change
// the saved agreement, the settlement or any invoice. Limited because it spends free-tier Gemini quota.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

let windows: Record<string, PriceWindow> | null = null;

export const POST = makeNegotiateHandler({
  households: demoConsumers,
  limiter: makeLimiter({ now: Date.now, cooldownMs: 60_000, dailyCap: Number(process.env.LIVE_NEGOTIATIONS_PER_DAY ?? 10) }),
  window: (id) => {
    windows ??= Object.fromEntries(loadDashboardPageData().view.households.map((h) => [h.id, h.window]));
    return windows[id];
  },
  // A failed Gemini call falls back to the rule, and the label says so.
  run: (id, window) => {
    const policy = geminiPolicy();
    return negotiate(demoProducer, demoConsumers[id], window, { producer: policy, consumer: policy });
  },
  now: Date.now,
});
