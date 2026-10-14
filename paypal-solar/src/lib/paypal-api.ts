/**
 * Minimal PayPal sandbox REST client used to verify, independently of the agent, what was created.
 * Note: PayPal reuses an access token until it expires (~9 h); after changing app features,
 * call terminateToken() so the next token carries the new scopes.
 */
const BASE = "https://api-m.sandbox.paypal.com";

let cached: { token: string; expiresAt: number } | null = null;

function basicAuth(): string {
  return "Basic " + Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
}

export async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

export async function terminateToken(): Promise<void> {
  const token = await getToken();
  await fetch(`${BASE}/v1/oauth2/token/terminate`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: `token=${token}&token_type_hint=ACCESS_TOKEN`,
  });
  cached = null;
}

export interface PayPalInvoice {
  id: string;
  status: string;
  detail: { invoice_number?: string; currency_code: string; metadata?: { recipient_view_url?: string } };
  primary_recipients?: { billing_info?: { email_address?: string } }[];
  amount: { currency_code: string; value: string };
  due_amount?: { value: string; currency_code?: string };
  payments?: { paid_amount?: { value: string; currency_code?: string } };
}

export async function getInvoice(id: string): Promise<PayPalInvoice> {
  const res = await fetch(`${BASE}/v2/invoicing/invoices/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  if (!res.ok) throw new Error(`PayPal get invoice ${id} failed: ${res.status}`);
  return (await res.json()) as PayPalInvoice;
}

/** The invoice with exactly this invoice number, or null. PayPal keeps invoice numbers unique per merchant. */
export async function findInvoiceByNumber(invoiceNumber: string): Promise<PayPalInvoice | null> {
  const res = await fetch(`${BASE}/v2/invoicing/search-invoices?page=1&page_size=20`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ invoice_number: invoiceNumber }),
  });
  if (!res.ok) throw new Error(`PayPal invoice search failed: ${res.status}`);
  const data = (await res.json()) as { items?: PayPalInvoice[] };
  const match = (data.items ?? []).find((i) => i.detail.invoice_number === invoiceNumber); // search may also match partially
  return match ? getInvoice(match.id) : null;
}

/** Sends a draft invoice to its recipient. */
export async function sendInvoice(id: string): Promise<void> {
  const res = await fetch(`${BASE}/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ send_to_recipient: true }),
  });
  if (!res.ok) throw new Error(`PayPal send invoice ${id} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}
