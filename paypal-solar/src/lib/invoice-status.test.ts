import { describe, expect, it, vi } from "vitest";
import type { IssuedInvoice } from "./issued";
import { makeStatusChecker } from "./invoice-status";
import type { PayPalInvoice } from "./paypal-api";

const rec = (n: string, amountEur: string): IssuedInvoice => ({
  invoiceId: `INV2-${n}`,
  invoiceNumber: `ES-${n}`,
  neighbour: n,
  sharedKWh: 1,
  priceCt: 1,
  amountEur,
  issued: "2026-10-12",
  statusAtRecord: "PAID",
});
const issued: [string, IssuedInvoice][] = [["K1", rec("A", "11.83")], ["K2", rec("B", "17.07")]];
const inv = (n: string, value: string, status = "PAID"): PayPalInvoice => ({ id: `INV2-${n}`, status, detail: { invoice_number: `ES-${n}`, currency_code: "EUR" }, amount: { currency_code: "EUR", value } });

describe("makeStatusChecker", () => {
  it("reads each issued invoice and compares number and amount with the record", async () => {
    const check = makeStatusChecker({ issued: () => issued, getInvoice: async (id) => (id === "INV2-A" ? inv("A", "11.83") : inv("B", "17.00", "SENT")), now: () => 0, ttlMs: 60_000 });
    const r = await check();
    expect(r.checkedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(r.items.map((i) => [i.status, i.matchesRecord])).toEqual([["PAID", true], ["SENT", false]]);
  });

  it("marks a failed read instead of inventing a status", async () => {
    const check = makeStatusChecker({ issued: () => issued, getInvoice: async () => { throw new Error("PayPal get invoice failed: 401"); }, now: () => 0, ttlMs: 60_000 });
    const r = await check();
    expect(r.items.every((i) => i.status === null && i.matchesRecord === null && i.error?.includes("401"))).toBe(true);
  });

  it("answers from the cache inside the TTL and asks PayPal again after it", async () => {
    let t = 1_000;
    const get = vi.fn(async (id: string) => inv(id.slice(5), id === "INV2-A" ? "11.83" : "17.07"));
    const check = makeStatusChecker({ issued: () => issued, getInvoice: get, now: () => t, ttlMs: 60_000 });
    const first = await check();
    t += 59_999;
    const second = await check();
    expect(second.cached).toBe(true);
    expect(second.checkedAt).toBe(first.checkedAt);
    expect(get).toHaveBeenCalledTimes(2);
    t += 1;
    const third = await check();
    expect(third.cached).toBe(false);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it("shares one running check between concurrent requests (no duplicate PayPal calls)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const get = vi.fn(async (id: string) => {
      await gate;
      return inv(id.slice(5), id === "INV2-A" ? "11.83" : "17.07");
    });
    const check = makeStatusChecker({ issued: () => issued, getInvoice: get, now: () => 0, ttlMs: 60_000 });
    const pending = [check(), check(), check()];
    release();
    const [a, b, c] = await Promise.all(pending);
    expect(get).toHaveBeenCalledTimes(2); // one read per invoice, not three
    expect([a.cached, b.cached, c.cached]).toEqual([false, true, true]);
    expect(b.checkedAt).toBe(a.checkedAt);
    expect(c.items).toEqual(a.items);
  });

  it("lets the next request start a new check after a shared check failed", async () => {
    let fail = true;
    let t = 0;
    const get = vi.fn(async (id: string) => {
      if (fail) throw new Error("network down");
      return inv(id.slice(5), id === "INV2-A" ? "11.83" : "17.07");
    });
    const check = makeStatusChecker({ issued: () => issued, getInvoice: get, now: () => t, ttlMs: 60_000 });
    const [x, y] = await Promise.all([check(), check()]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(x.items.every((i) => i.status === null) && y.items.every((i) => i.status === null)).toBe(true);
    fail = false;
    t = 60_000;
    const z = await check();
    expect(z.items.map((i) => i.status)).toEqual(["PAID", "PAID"]);
  });
});
