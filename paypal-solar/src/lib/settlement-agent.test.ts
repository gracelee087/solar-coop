import { tool, type ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { demoGroup } from "./demo-group";
import { settlementKey, type InvoiceInput } from "./invoice";
import { findIssued } from "./issued";
import type { PayPalInvoice } from "./paypal-api";
import { guardedTools, settleWithAgent } from "./settlement-agent";

// No PayPal or Gemini calls: the toolkit tools and the invoice read-back are replaced by fakes.
const input: InvoiceInput = {
  producer: { name: "Haus 12", email: "seller@business.example.com" },
  consumer: { name: "Haus 10", email: "buyer@personal.example.com" },
  period: "2026-06",
  sharedKWh: 80,
  priceCt: 12.5,
  amountCents: 1000,
  invoiceNumber: "ES-202606-P1-H1",
  invoiceDate: "2026-07-01",
};

const invoice = (status: string, value: string): PayPalInvoice => ({
  id: "INV2-AAAA-BBBB-CCCC-DDDD",
  status,
  detail: { invoice_number: input.invoiceNumber, currency_code: "EUR" },
  primary_recipients: [{ billing_info: { email_address: input.consumer.email } }],
  amount: { currency_code: "EUR", value },
});

function fakes(stored: PayPalInvoice) {
  const sendSpy = vi.fn(async () => ({ ok: true }));
  const fake = (execute: () => Promise<unknown>) => tool({ description: "fake", inputSchema: z.object({}).passthrough(), execute });
  const create = fake(async () => JSON.stringify({ id: stored.id, status: "DRAFT" }));
  const base: ToolSet = { create_invoice: create, send_invoice: fake(sendSpy), get_invoice: fake(async () => stored) };
  return { deps: { base, creator: { create_invoice: create }, getInvoice: async () => stored }, sendSpy };
}

const call = (tools: ToolSet, name: string, args: unknown) =>
  (tools[name] as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(args, { toolCallId: "t", messages: [] });

describe("guardedTools send_invoice", () => {
  it("does not send after the monthly agent is stopped", async () => {
    const { deps, sendSpy } = fakes(invoice("DRAFT", "10.00"));
    const controller = new AbortController();
    const { tools, state } = guardedTools(input, deps, controller.signal);
    await call(tools, "create_invoice", {});
    controller.abort();
    await expect(call(tools, "send_invoice", { invoice_id: state.invoiceId })).rejects.toThrow();
    expect(sendSpy).not.toHaveBeenCalled();
  });
  it("does not send when create returned an invoice with a different amount (e.g. an older one)", async () => {
    const { deps, sendSpy } = fakes(invoice("DRAFT", "11.00")); // expected 10.00
    const { tools, state } = guardedTools(input, deps);
    await call(tools, "create_invoice", {});
    const out = String(await call(tools, "send_invoice", { invoice_id: state.invoiceId }));
    expect(sendSpy).not.toHaveBeenCalled();
    expect(out).toContain("Not sent");
    expect(state.blocked).toEqual(["amount 11.00 ≠ 10.00"]);
  });

  it("sends a matching draft", async () => {
    const { deps, sendSpy } = fakes(invoice("DRAFT", "10.00"));
    const { tools, state } = guardedTools(input, deps);
    await call(tools, "create_invoice", {});
    await call(tools, "send_invoice", { invoice_id: state.invoiceId });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(state.blocked).toEqual([]);
  });

  it("does not send again when the matching invoice was already sent (concurrent run)", async () => {
    const { deps, sendSpy } = fakes(invoice("SENT", "10.00"));
    const { tools, state } = guardedTools(input, deps);
    await call(tools, "create_invoice", {});
    await call(tools, "send_invoice", { invoice_id: state.invoiceId });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("refuses to send an invoice id that this run did not create", async () => {
    const { deps, sendSpy } = fakes(invoice("DRAFT", "10.00"));
    const { tools } = guardedTools(input, deps);
    await call(tools, "create_invoice", {});
    await call(tools, "send_invoice", { invoice_id: "INV2-ZZZZ-ZZZZ-ZZZZ-ZZZZ" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("allows create_invoice only once per run", async () => {
    const { deps } = fakes(invoice("DRAFT", "10.00"));
    const { tools, state } = guardedTools(input, deps);
    await call(tools, "create_invoice", {});
    const second = String(await call(tools, "create_invoice", { invoice_number: "ES-OTHER" }));
    expect(second).toContain("only once");
    expect(state.attempts).toBe(2);
  });
});

describe("settleWithAgent for a settlement already invoiced under an older number", () => {
  it("returns already_invoiced for every June 2026 neighbour without calling PayPal or Gemini", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const h of demoGroup.households) {
      const r = await settleWithAgent({ ...input, invoiceNumber: settlementKey("2026-06", "p1", h.id) });
      expect(r.outcome).toBe("already_invoiced");
      expect(r.invoiceId).toBe(findIssued(settlementKey("2026-06", "p1", h.id))?.invoiceId);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("is not triggered for a month that was never invoiced", () => {
    expect(findIssued(settlementKey("2026-07", "p1", "h1"))).toBeNull();
  });
});

describe("settlement input validation", () => {
  it.each([
    { sharedKWh: NaN }, { sharedKWh: Infinity }, { sharedKWh: 0 },
    { priceCt: NaN }, { priceCt: Infinity }, { priceCt: -1 },
    { amountCents: NaN }, { amountCents: Infinity }, { amountCents: 0 },
    { amountCents: 1000.5 },
  ])("blocks invalid settlement %j before PayPal or Gemini", async (invalid) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected network call"); });
    try {
      const bad = { ...input, invoiceNumber: "ES-202607-P1-H1", ...invalid };
      const result = await settleWithAgent(bad);
      expect(result.outcome).toBe("failed");
      expect(result.problems.length).toBeGreaterThan(0);
      expect(result.toolCalls).toEqual([]);
      expect(result.model).toBeNull();
      expect(() => guardedTools(bad)).toThrow("Invalid settlement");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  const noNetwork = () => vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected network call"); });

  it("returns no_invoice for zero shared energy and zero amount, without PayPal or Gemini", async () => {
    const fetchSpy = noNetwork();
    try {
      const result = await settleWithAgent({ ...input, invoiceNumber: "ES-202607-P1-H1", sharedKWh: 0, amountCents: 0 });
      expect(result).toEqual({ outcome: "no_invoice", invoiceId: null, invoice: null, problems: [], toolCalls: [], model: null });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it.each([
    { sharedKWh: 0, amountCents: 1000 },
    { sharedKWh: 80, amountCents: 0 },
    { sharedKWh: 0, amountCents: 0, priceCt: NaN },
    { sharedKWh: 0, amountCents: 0, priceCt: 0 },
    { sharedKWh: -0.5, amountCents: 0 },
  ])("keeps zero cases with other invalid input as failed %j, without PayPal or Gemini", async (invalid) => {
    const fetchSpy = noNetwork();
    try {
      const result = await settleWithAgent({ ...input, invoiceNumber: "ES-202607-P1-H1", ...invalid });
      expect(result.outcome).toBe("failed");
      expect(result.problems.length).toBeGreaterThan(0);
      expect(result.model).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
