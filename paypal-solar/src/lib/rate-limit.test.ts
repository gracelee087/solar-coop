import { describe, expect, it } from "vitest";
import { makeLimiter } from "./rate-limit";

describe("makeLimiter", () => {
  it("allows one run at a time", () => {
    const l = makeLimiter({ now: () => 0, cooldownMs: 0, dailyCap: 10 });
    expect(l.acquire("a").ok).toBe(true);
    expect(l.acquire("b")).toMatchObject({ ok: false, reason: "Another live negotiation is running." });
    l.release();
    expect(l.acquire("b").ok).toBe(true);
  });

  it("makes the same caller wait for the cooldown", () => {
    let t = 0;
    const l = makeLimiter({ now: () => t, cooldownMs: 60_000, dailyCap: 10 });
    l.acquire("a");
    l.release();
    t = 59_000;
    expect(l.acquire("a")).toEqual({ ok: false, reason: "Please wait before starting another live negotiation.", retryAfterSec: 1 });
    expect(l.acquire("b").ok).toBe(true); // other callers are not blocked by a's cooldown
    l.release();
    t = 60_000;
    expect(l.acquire("a").ok).toBe(true);
  });

  it("stops at the daily cap and starts again the next UTC day", () => {
    let t = Date.parse("2026-10-13T23:00:00Z");
    const l = makeLimiter({ now: () => t, cooldownMs: 0, dailyCap: 2 });
    for (const c of ["a", "b"]) {
      expect(l.acquire(c).ok).toBe(true);
      l.release();
    }
    expect(l.acquire("c")).toEqual({ ok: false, reason: "Daily limit of 2 live negotiations reached.", retryAfterSec: 3600 });
    t = Date.parse("2026-10-14T00:00:01Z");
    expect(l.acquire("c").ok).toBe(true);
  });
});
