import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { aggregateCoopMonth, allocateCoopInterval, validateCoopGroup } from "./allocation";
import { PaymentLedger } from "./ledger";
import { checkMemo, paymentMemo } from "./limits";
import { csvHeader, parseMeterCsv, toMeterCsv } from "./meter-csv";
import { paypalRail, type Http, type PaymentRail, type RailRequest } from "./rail";
import { sampleCoop } from "./sample-group";
import { withSandboxEmails } from "./sandbox-accounts";
import { settleMonth } from "./statements";
import { coopTools } from "./tools";
import type { CoopGroup, MeterInterval } from "./types";

const CSV = readFileSync(path.join(__dirname, "..", "..", "data", "coop-meter-2026-06.csv"), "utf8");
const june = parseMeterCsv(sampleCoop, "2026-06", CSV);

const small: CoopGroup = {
  id: "t",
  participants: [
    { id: "P1", name: "P1", role: "producer", email: "p1@example.com" },
    { id: "P2", name: "P2", role: "producer", email: "p2@example.com" },
    { id: "C1", name: "C1", role: "consumer", email: "c1@example.com" },
    { id: "C2", name: "C2", role: "consumer", email: "c2@example.com" },
  ],
  assets: [
    { id: "A1", ownerId: "P1", kWp: 5 },
    { id: "A2", ownerId: "P2", kWp: 5 },
  ],
  keys: { C1: 0.5, C2: 0.5 },
  priceCt: 13,
  operatorFeeCt: 1,
};

function fakeRail(fail = false) {
  const calls: RailRequest[] = [];
  const rail: PaymentRail = {
    name: "fake",
    execute: async (req) => {
      calls.push(req);
      if (fail) throw new Error("timeout");
      return { externalId: `X-${calls.length}`, status: "SENT" };
    },
  };
  return { rail, calls };
}

const at = (iso: string) => () => new Date(iso);

describe("pooled static allocation", () => {
  it("caps each consumer at its load and credits producers by feed-in share", () => {
    const a = allocateCoopInterval(small, { start: "s", feedInWh: { P1: 300, P2: 100 }, consumptionWh: { C1: 50, C2: 500 } });
    expect(a.receivedWh).toEqual({ C1: 50, C2: 200 }); // offers are 200 Wh each
    expect(a.soldWh).toEqual({ P1: 188, P2: 62 }); // 250 Wh split 3:1 (187.5/62.5, tie goes to P1)
    expect(a.surplusWh).toEqual({ P1: 112, P2: 38 });
  });

  it("keeps the invariants in every interval of the sample month", () => {
    expect(june).toHaveLength(30 * 96);
    for (const iv of june) {
      const a = allocateCoopInterval(sampleCoop, iv);
      const pool = Object.values(iv.feedInWh).reduce((s, x) => s + x, 0);
      const received = Object.values(a.receivedWh).reduce((s, x) => s + x, 0);
      const sold = Object.values(a.soldWh).reduce((s, x) => s + x, 0);
      expect(received).toBeLessThanOrEqual(pool);
      expect(sold).toBe(received);
      for (const [id, load] of Object.entries(iv.consumptionWh)) expect(a.receivedWh[id]).toBeLessThanOrEqual(load);
      for (const [id, f] of Object.entries(iv.feedInWh)) expect(a.soldWh[id] + a.surplusWh[id]).toBe(f);
    }
  });

  it("rejects keys above 1 and a producer without PV", () => {
    expect(() => validateCoopGroup({ ...small, keys: { C1: 0.6, C2: 0.5 } })).toThrow(/above 1/);
    expect(() => validateCoopGroup({ ...small, assets: [small.assets[0]] })).toThrow(/no PV asset/);
  });
});

describe("monthly settlement", () => {
  const month = aggregateCoopMonth(sampleCoop, "2026-06", june);
  const s = settleMonth(sampleCoop, month);

  it("balances: bills = payouts + operator share, energy received = energy credited", () => {
    const billed = s.consumers.reduce((t, c) => t + c.amountCents, 0);
    const paid = s.producers.reduce((t, p) => t + p.amountCents, 0);
    expect(billed - paid).toBe(s.operatorRetainedCents);
    expect(s.operatorRetainedCents).toBeGreaterThanOrEqual(0);
    expect(s.consumers.reduce((t, c) => t + c.receivedWh, 0)).toBe(s.producers.reduce((t, p) => t + p.soldWh, 0));
    expect(s.consumers).toHaveLength(7);
    expect(s.producers).toHaveLength(3);
    expect(billed).toBeGreaterThan(0);
  });

  it("matches the monthly totals of the intervals", () => {
    for (const c of s.consumers) {
      const sum = june.reduce((t, iv) => t + allocateCoopInterval(sampleCoop, iv).receivedWh[c.participantId], 0);
      expect(c.receivedWh).toBe(sum);
      expect(c.amountCents).toBe(Math.round((sum * 13) / 1000));
    }
    expect(s.consumers[0].statementId).toBe("ST-202606-H04");
    expect(s.producers[0].statementId).toBe("PO-202606-H01");
  });
});

describe("meter CSV", () => {
  it("round-trips the sample file", () => {
    expect(toMeterCsv(sampleCoop, june)).toBe(CSV.replace(/\r\n/g, "\n"));
  });

  const head = csvHeader(small).join(",");
  const rows = (values: string[]) => [head, ...values].join("\n");
  const fullDay = (from = 0) =>
    Array.from({ length: 96 - from }, (_, q) => {
      const n = q + from;
      return `2026-02-28T${String(Math.floor(n / 4)).padStart(2, "0")}:${String((n % 4) * 15).padStart(2, "0")}:00+01:00,1,1,1,1`;
    });

  it("rejects wrong headers, negative values, gaps and incomplete months", () => {
    expect(() => parseMeterCsv(small, "2026-06", "start,x\n2026-06-01T00:00:00+02:00,1")).toThrow(/header/);
    expect(() => parseMeterCsv(small, "2026-06", rows(["2026-06-01T00:00:00+02:00,1,-1,1,1"]))).toThrow(/non-negative integer/);
    expect(() => parseMeterCsv(small, "2026-06", rows(["2026-06-01T00:00:00+02:00,1,1,1,1", "2026-06-01T00:30:00+02:00,1,1,1,1"]))).toThrow(/15 minutes/);
    expect(() => parseMeterCsv(small, "2026-06", rows(["2026-06-01T00:00:00+02:00,1,1,1,1"]))).toThrow(/23:45/);
    expect(() => parseMeterCsv(small, "2026-02", rows(fullDay(1)))).toThrow(/00:00 on day 1/);
  });
});

describe("hard limits and DSGVO memo", () => {
  const ledger = () => new PaymentLedger(sampleCoop.participants, fakeRail().rail, at("2026-07-01T08:00:00Z"));

  it("allows exactly 500.00 € and refuses 500.01 €", () => {
    const l = ledger();
    expect(l.draft({ kind: "bill", participantId: "H04", period: "2026-06", statementId: "A", amountCents: 50_000 }).status).toBe("draft");
    expect(() => l.draft({ kind: "bill", participantId: "H05", period: "2026-06", statementId: "B", amountCents: 50_001 })).toThrow(/500 €/);
  });

  it("refuses execution once the day's total would pass 5,000 €", async () => {
    const l = ledger();
    const ids = Array.from({ length: 11 }, (_, i) => {
      const id = l.draft({ kind: "bill", participantId: "H04", period: "2026-06", statementId: `S${i}`, amountCents: 50_000 }).id;
      l.requestApproval(id);
      l.approve(id, "operator");
      return id;
    });
    for (const id of ids.slice(0, 10)) expect((await l.execute(id)).status).toBe("executed");
    await expect(l.execute(ids[10])).rejects.toThrow(/5,000 €/);
  });

  it("counts payments executed today in other months' ledgers against the same daily limit", async () => {
    const l = ledger();
    const id = l.draft({ kind: "bill", participantId: "H04", period: "2026-06", statementId: "S", amountCents: 50_000 }).id;
    l.requestApproval(id);
    l.approve(id, "operator");
    await expect(l.execute(id, undefined, 460_000)).rejects.toThrow(/5,000 €/);
    expect((await l.execute(id, undefined, 450_000)).status).toBe("executed");
  });

  it("keeps meter detail out of payment memos", () => {
    expect(paymentMemo("bill", "2026-06", "ST-202606-H04")).toBe("Energy sharing bill 2026-06, ref ST-202606-H04");
    expect(checkMemo("12.5 kWh in June")).toMatch(/energy/);
    expect(checkMemo("peak at 12:15")).toMatch(/times/);
  });
});

describe("approval flow", () => {
  const bill = { kind: "bill" as const, participantId: "H04", period: "2026-06", statementId: "ST-202606-H04", amountCents: 1234 };

  it("never executes without human approval and executes an approved draft once", async () => {
    const { rail, calls } = fakeRail();
    const l = new PaymentLedger(sampleCoop.participants, rail, at("2026-07-01T08:00:00Z"));
    const d = l.draft(bill);
    await expect(l.execute(d.id)).rejects.toThrow(/expected approved/);
    l.requestApproval(d.id);
    await expect(l.execute(d.id)).rejects.toThrow(/expected approved/);
    l.approve(d.id, "operator");
    const done = await l.execute(d.id);
    expect(done.status).toBe("executed");
    expect(done.approval?.by).toBe("operator");
    await expect(l.execute(d.id)).rejects.toThrow(/executed/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ draftId: "bill-ST-202606-H04", recipient: { email: "h04@example.com" }, amountCents: 1234 });
  });

  it("lets the caller save the executing state before the provider is called", async () => {
    const seen: string[] = [];
    const rail: PaymentRail = { name: "spy", execute: async () => (seen.push("rail"), { externalId: "X", status: "SENT" }) };
    const l = new PaymentLedger(sampleCoop.participants, rail);
    const id = l.draft(bill).id;
    l.requestApproval(id);
    l.approve(id, "operator");
    await l.execute(id, (drafts) => seen.push(`saved:${drafts.find((d) => d.id === id)!.status}`));
    expect(seen).toEqual(["saved:executing", "rail"]);
  });

  it("maps households only to PayPal sandbox accounts for sandbox execution", () => {
    const mapped = withSandboxEmails(sampleCoop.participants);
    expect(mapped).toHaveLength(10);
    for (const p of mapped) expect(p.email).toMatch(/^sb-.+@personal\.example\.com$/);
  });

  it("returns the existing draft for the same statement and refuses a changed amount", () => {
    const l = new PaymentLedger(sampleCoop.participants, fakeRail().rail);
    expect(l.draft(bill).id).toBe(l.draft(bill).id);
    expect(() => l.draft({ ...bill, amountCents: 999 })).toThrow(/different amount/);
    expect(l.list()).toHaveLength(1);
  });

  it("refuses bills to producers and payouts to consumers", () => {
    const l = new PaymentLedger(sampleCoop.participants, fakeRail().rail);
    expect(() => l.draft({ ...bill, participantId: "H01" })).toThrow(/not a consumer/);
    expect(() => l.draft({ ...bill, kind: "payout" })).toThrow(/not a producer/);
  });

  it("marks a failed execution and does not retry it", async () => {
    const { rail, calls } = fakeRail(true);
    const l = new PaymentLedger(sampleCoop.participants, rail);
    const id = l.draft(bill).id;
    l.requestApproval(id);
    l.approve(id, "operator");
    expect((await l.execute(id)).status).toBe("failed");
    await expect(l.execute(id)).rejects.toThrow(/failed/);
    expect(calls).toHaveLength(1);
  });

  it("keeps all refunds of a bill within its amount, each needing approval", async () => {
    const { rail, calls } = fakeRail();
    const l = new PaymentLedger(sampleCoop.participants, rail);
    const id = l.draft(bill).id;
    expect(() => l.draftRefund(id, 100, "CAP1")).toThrow(/not executed/);
    l.requestApproval(id);
    l.approve(id, "operator");
    await l.execute(id);
    const r1 = l.draftRefund(id, 1000, "CAP1");
    expect(() => l.draftRefund(id, 235, "CAP1")).toThrow(/exceed the bill/);
    expect(l.draftRefund(id, 234, "CAP1").id).toBe("refund-ST-202606-H04-2");
    await expect(l.execute(r1.id)).rejects.toThrow(/expected approved/);
    l.requestApproval(r1.id);
    l.approve(r1.id, "operator");
    await l.execute(r1.id);
    expect(calls[1]).toMatchObject({ kind: "refund", captureId: "CAP1", amountCents: 1000 });
  });

  it("gives every refund a new id, so a rejected refund never makes a later one overwrite an executed refund", async () => {
    const { rail, calls } = fakeRail();
    const l = new PaymentLedger(sampleCoop.participants, rail);
    const id = l.draft(bill).id;
    l.requestApproval(id);
    l.approve(id, "operator");
    await l.execute(id);
    const r1 = l.draftRefund(id, 400, "CAP1");
    const r2 = l.draftRefund(id, 600, "CAP1");
    l.reject(r1.id, "operator", "wrong amount");
    l.requestApproval(r2.id);
    l.approve(r2.id, "operator");
    await l.execute(r2.id);
    const r3 = l.draftRefund(id, 400, "CAP1");
    expect(new Set([r1.id, r2.id, r3.id]).size).toBe(3);
    expect(l.get(r2.id)).toMatchObject({ status: "executed", amountCents: 600 });
    expect(l.get(r1.id).status).toBe("rejected");
    expect(() => l.draftRefund(id, 235, "CAP1")).toThrow(/exceed the bill/); // 600 executed + 400 drafted + 235 > 1234
    expect(calls.filter((c) => c.kind === "refund")).toHaveLength(1);
  });
});

describe("PayPal rail request shapes (fake HTTP, no network)", () => {
  const base: RailRequest = {
    draftId: "payout-PO-202606-H01",
    kind: "payout",
    recipient: { name: "Haus 1", email: "h01@example.com" },
    amountCents: 4321,
    currency: "EUR",
    memo: "Energy sharing payout 2026-06, ref PO-202606-H01",
    period: "2026-06",
    statementId: "PO-202606-H01",
  };

  it("sends a payout with an idempotency key and no meter data", async () => {
    const http = vi.fn<Http>(async () => ({ batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } }));
    expect(await paypalRail(http).execute(base)).toEqual({ externalId: "B1", status: "PENDING" });
    const [, p, body, headers] = http.mock.calls[0];
    expect(p).toBe("/v1/payments/payouts");
    expect(headers).toEqual({ "PayPal-Request-Id": "payout-PO-202606-H01" });
    expect(body).toMatchObject({ items: [{ receiver: "h01@example.com", amount: { value: "43.21", currency: "EUR" } }] });
    expect(JSON.stringify(body)).not.toMatch(/wh\b/i);
  });

  it("creates then sends an invoice numbered by the statement", async () => {
    const http = vi.fn<Http>(async (_m, p) => (p === "/v2/invoicing/invoices" ? { href: "https://x/v2/invoicing/invoices/INV2-1" } : {}));
    const res = await paypalRail(http).execute({ ...base, kind: "bill", draftId: "bill-ST-202606-H04", statementId: "ST-202606-H04" });
    expect(res).toEqual({ externalId: "INV2-1", status: "SENT" });
    expect(http.mock.calls[0][2]).toMatchObject({ detail: { invoice_number: "ST-202606-H04" } });
    expect(http.mock.calls[1][1]).toBe("/v2/invoicing/invoices/INV2-1/send");
  });

  it("refuses a refund without a capture id", async () => {
    await expect(paypalRail(vi.fn<Http>()).execute({ ...base, kind: "refund" })).rejects.toThrow(/capture id/);
  });
});

describe("agent tools", () => {
  type Run = (input: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown>;
  const run = (t: unknown, input: unknown) => (t as { execute: Run }).execute(input, { toolCallId: "t", messages: [] });

  it("draft amounts come from the settlement and execution still needs a human", async () => {
    const { rail, calls } = fakeRail();
    const ledger = new PaymentLedger(sampleCoop.participants, rail);
    const tools = coopTools({ group: sampleCoop, ledger, loadMonth: (): MeterInterval[] => june });
    await expect(run(tools.draft_invoice, { period: "2026-06", participantId: "H04" })).rejects.toThrow(/calculate_settlement/);
    const s = (await run(tools.calculate_settlement, { period: "2026-06" })) as ReturnType<typeof settleMonth>;
    const d = (await run(tools.draft_invoice, { period: "2026-06", participantId: "H04" })) as { id: string; amountCents: number };
    expect(d.amountCents).toBe(s.consumers[0].amountCents);
    await run(tools.request_approval, { draftId: d.id });
    await expect(run(tools.execute_payment, { draftId: d.id })).rejects.toThrow(/expected approved/);
    expect(calls).toHaveLength(0);
    expect(Object.keys(tools).sort()).toEqual(["calculate_settlement", "draft_invoice", "draft_payout", "execute_payment", "refund", "request_approval"]);
    const p = (await run(tools.draft_payout, { period: "2026-06", participantId: "H01" })) as { amountCents: number };
    expect(p.amountCents).toBe(s.producers[0].amountCents);
    await expect(run(tools.draft_payout, { period: "2026-06", participantId: "H04" })).rejects.toThrow(/not a producer/);
  });
});
