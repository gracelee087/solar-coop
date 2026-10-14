import { negotiationLabel } from "./dashboard";
import type { LiveNegotiation, NegotiationResult } from "./negotiation";
import type { PriceWindow } from "./pricing";
import type { makeLimiter } from "./rate-limit";

/**
 * The household id from a request body, or null. Only the household ids themselves are accepted: an inherited
 * key such as "toString" or "constructor" is not a household, nor is a non-object body such as null.
 */
export function parseHouseholdId(body: unknown, households: Record<string, unknown>): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const id = (body as Record<string, unknown>).householdId;
  return typeof id === "string" && Object.hasOwn(households, id) ? id : null;
}

/**
 * POST handler of the live negotiation. Invalid input is refused with 400 before the limiter is asked, so it never
 * uses up anyone's quota; the run itself is injected so tests need no Gemini call.
 */
export function makeNegotiateHandler(deps: {
  households: Record<string, unknown>;
  limiter: ReturnType<typeof makeLimiter>;
  window: (householdId: string) => PriceWindow;
  run: (householdId: string, window: PriceWindow) => Promise<NegotiationResult>;
  now: () => number;
}) {
  return async (req: Request): Promise<Response> => {
    const body = await req.json().catch(() => undefined);
    const id = parseHouseholdId(body, deps.households);
    if (!id) return Response.json({ error: "Unknown household." }, { status: 400 });

    const caller = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const gate = deps.limiter.acquire(caller);
    if (!gate.ok) return Response.json({ error: gate.reason, retryAfterSec: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
    try {
      const window = deps.window(id);
      const result = await deps.run(id, window);
      const live: LiveNegotiation = { at: new Date(deps.now()).toISOString(), householdId: id, window, label: negotiationLabel(result.offers, "live"), result };
      return Response.json(live);
    } catch (e) {
      return Response.json({ error: `Live negotiation failed: ${(e as Error).message.slice(0, 120)}` }, { status: 502 });
    } finally {
      deps.limiter.release();
    }
  };
}
