import { getToken } from "../paypal-api";
import type { PayoutObservation } from "./reconcile";

export type PaymentKind = "bill" | "payout" | "refund";

export interface RailRequest {
  /** Ledger draft id, sent as PayPal-Request-Id where the API supports it, so a repeated request runs once. */
  draftId: string;
  kind: PaymentKind;
  recipient: { name: string; email: string };
  amountCents: number;
  currency: "EUR";
  memo: string;
  period: string;
  statementId: string;
  /** Refunds only: the PayPal capture to refund. */
  captureId?: string;
}

export interface RailResult {
  externalId: string;
  status: string;
}

/** A payment rail executes one already approved payment. Limits and approval are enforced before, by the ledger. */
export interface PaymentRail {
  readonly name: string;
  execute(req: RailRequest): Promise<RailResult>;
}

export type Http = (method: "POST" | "GET", path: string, body: unknown, headers?: Record<string, string>) => Promise<Record<string, unknown>>;

const SANDBOX = "https://api-m.sandbox.paypal.com";
const eur = (cents: number) => (cents / 100).toFixed(2);

/** Sandbox-only HTTP client for the PayPal REST API (token from paypal-api.ts). */
export const paypalSandboxHttp: Http = async (method, path, body, headers = {}) => {
  const res = await fetch(`${SANDBOX}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
};

/**
 * PayPal rail (sandbox). Request shapes follow PayPal's published OpenAPI schemas (checked 2026-10-14):
 * Invoicing v2 create + send, Payouts v1 `POST /v1/payments/payouts`, Payments v2 capture refund. A June run against the
 * sandbox is archived in `src/data/submission/sandbox-june.json`; tests use a fake `http`. The Agent Toolkit has no
 * payouts tool, so this calls REST directly.
 */
export function paypalRail(http: Http = paypalSandboxHttp): PaymentRail {
  return {
    name: "paypal",
    async execute(req) {
      if (req.currency !== "EUR") throw new Error("Only EUR is supported");
      if (req.kind === "bill") {
        // Invoice create has no PayPal-Request-Id in the schema; the unique invoice number is the duplicate guard.
        const created = await http("POST", "/v2/invoicing/invoices", {
          detail: { currency_code: "EUR", invoice_number: req.statementId, note: req.memo },
          primary_recipients: [{ billing_info: { email_address: req.recipient.email } }],
          items: [{ name: req.memo, quantity: "1", unit_amount: { currency_code: "EUR", value: eur(req.amountCents) } }],
        });
        const id = (created.id as string | undefined) ?? String(created.href ?? "").split("/").pop();
        if (!id) throw new Error("PayPal create invoice returned no id");
        await http("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { send_to_recipient: true });
        return { externalId: id, status: "SENT" };
      }
      if (req.kind === "payout") {
        const res = await http(
          "POST",
          "/v1/payments/payouts",
          {
            sender_batch_header: { sender_batch_id: req.draftId, recipient_type: "EMAIL", email_subject: req.memo },
            items: [
              {
                recipient_type: "EMAIL",
                receiver: req.recipient.email,
                amount: { value: eur(req.amountCents), currency: "EUR" },
                note: req.memo,
                sender_item_id: req.statementId,
              },
            ],
          },
          { "PayPal-Request-Id": req.draftId },
        );
        const header = res.batch_header as { payout_batch_id?: string; batch_status?: string } | undefined;
        if (!header?.payout_batch_id) throw new Error("PayPal payout returned no batch id");
        return { externalId: header.payout_batch_id, status: header.batch_status ?? "UNKNOWN" };
      }
      if (!req.captureId) throw new Error("Refund needs the PayPal capture id");
      const res = await http(
        "POST",
        `/v2/payments/captures/${encodeURIComponent(req.captureId)}/refund`,
        { amount: { value: eur(req.amountCents), currency_code: "EUR" }, invoice_id: req.draftId, note_to_payer: req.memo },
        { "PayPal-Request-Id": req.draftId },
      );
      if (typeof res.id !== "string") throw new Error("PayPal refund returned no id");
      return { externalId: res.id, status: String(res.status ?? "UNKNOWN") };
    },
  };
}

/** Read-only payout batch with its items (`GET /v1/payments/payouts/{id}`). */
export async function getPayoutBatch(batchId: string, http: Http = paypalSandboxHttp): Promise<PayoutObservation> {
  return (await http("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`, undefined)) as PayoutObservation;
}
