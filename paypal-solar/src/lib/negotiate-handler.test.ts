import { describe, expect, it, vi } from "vitest";
import { makeNegotiateHandler, parseHouseholdId } from "./negotiate-handler";
import type { NegotiationResult } from "./negotiation";
import { makeLimiter } from "./rate-limit";

// No Gemini call: the negotiation run is a fake.
const households = { h1: {}, h2: {} };
const window = { floorCt: 9.3, ceilingCt: 16.97, viable: true };
const deal: NegotiationResult = { agreed: true, priceCt: 13, offers: [], reason: "ok" };
const post = (body: string, ip = "1.1.1.1") => new Request("http://x/api/negotiate", { method: "POST", body, headers: { "x-forwarded-for": ip } });
const setup = (run = vi.fn(async () => deal), dailyCap = 1) => {
  const limiter = makeLimiter({ now: () => 0, cooldownMs: 60_000, dailyCap });
  const acquire = vi.spyOn(limiter, "acquire");
  return { handler: makeNegotiateHandler({ households, limiter, window: () => window, run, now: () => 0 }), run, acquire };
};

describe("parseHouseholdId", () => {
  it.each([null, undefined, 5, "h1", [], ["h1"], {}, { householdId: 1 }, { householdId: "toString" }, { householdId: "constructor" }, { householdId: "__proto__" }, { householdId: "hasOwnProperty" }])(
    "refuses %j",
    (body) => expect(parseHouseholdId(body, households)).toBeNull(),
  );
  it("accepts a household id", () => expect(parseHouseholdId({ householdId: "h2" }, households)).toBe("h2"));
});

describe("negotiate handler", () => {
  it.each(["null", '{"householdId":"toString"}', '{"householdId":"constructor"}', '{"householdId":null}', "not json", "[]"])(
    "answers 400 for %s before using any quota",
    async (body) => {
      const { handler, run, acquire } = setup();
      const res = await handler(post(body));
      expect(res.status).toBe(400);
      expect(acquire).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("still allows a valid run after invalid requests (daily cap 1 not used up)", async () => {
    const { handler, run } = setup();
    for (const b of ["null", '{"householdId":"toString"}']) await handler(post(b));
    const res = await handler(post('{"householdId":"h2"}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ householdId: "h2", label: "Live: no offers", result: deal });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("answers 429 with Retry-After when limited, and 502 when the run fails, releasing the lock", async () => {
    const { handler } = setup(vi.fn(async () => deal), 1);
    await handler(post('{"householdId":"h1"}', "a"));
    const limited = await handler(post('{"householdId":"h1"}', "b"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).not.toBeNull();

    const failing = setup(vi.fn(async () => { throw new Error("model down"); }), 5);
    const res = await failing.handler(post('{"householdId":"h1"}', "c"));
    expect(res.status).toBe(502);
    const next = await failing.handler(post('{"householdId":"h2"}', "d"));
    expect(next.status).toBe(502); // not 429 "already running": the lock was released
  });
});
