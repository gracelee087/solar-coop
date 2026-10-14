import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../app/api/settlement-review/route";
import { runMonthlyRehearsal } from "./monthly-rehearsal";
import { makeReviewPacket, renderReviewPacket } from "./settlement-review";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No external calls"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it("exports known observations while leaving real cash, expenses and taxable profit unknown", async () => {
  const result = await runMonthlyRehearsal("normal");
  const packet = makeReviewPacket(result.first);
  expect(packet.status).toBe("DRAFT_DEMO_NOT_FOR_TAX_FILING");
  expect(packet.summary).toMatchObject({ cases: 3, calculatedEnergyChargesCents: 4431, checkedPaymentObservationsCents: 4431, actualCashReceiptsCents: null, actualFeesCents: null, taxableProfitCents: null });
  expect(packet.rows.every((row) => row.actualRefundCents === null && row.paymentEnvironment === "simulated")).toBe(true);
  expect(packet.evidence).toHaveLength(42);
});

it("does not export an unmatched or modified payment as checked receipts", async () => {
  const result = await runMonthlyRehearsal("amount_mismatch");
  expect(makeReviewPacket(result.first).rows[0].observedPaymentCents).toBe(null);
  const normal = await runMonthlyRehearsal("normal");
  normal.first.items[0].evidence.findLast((e) => e.kind === "payment")!.snapshot = { fabricated: true };
  expect(makeReviewPacket(normal.first).rows[0].observedPaymentCents).toBe(null);
  normal.first.items[1].input!.amountCents++;
  expect(makeReviewPacket(normal.first).rows[1].observedPaymentCents).toBe(null);
});

it("escapes source text in the printable export", async () => {
  const result = await runMonthlyRehearsal("normal");
  result.first.items[0].name = '<script>alert("bad")</script>';
  const html = renderReviewPacket(makeReviewPacket(result.first));
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("NOT FOR TAX FILING");
});

it.each(["source=live", "format=csv", "source=recorded&source=simulation", "file=secrets"])("rejects unsupported export parameters %s", async (query) => {
  expect((await GET(new Request(`http://local/api/settlement-review?${query}`))).status).toBe(400);
});

it("defaults to local recorded data and does not turn historical PAID labels into checked money", async () => {
  const response = await GET(new Request("http://local/api/settlement-review?format=json"));
  const packet = await response.json();
  expect(packet.execution).toBe("local_preview");
  expect(packet.summary.checkedPaymentObservationsCents).toBe(0);
  expect(packet.rows.every((row: { observedPaymentCents: number | null }) => row.observedPaymentCents === null)).toBe(true);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
