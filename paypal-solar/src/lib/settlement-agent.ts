import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { withModelFallback } from "./gemini";
import { buildCreateInvoiceArgs, classifyInvoiceInput, decideExisting, verifyInvoice, type InvoiceInput } from "./invoice";
import { findIssued } from "./issued";
import { findInvoiceByNumber, getInvoice, sendInvoice, type PayPalInvoice } from "./paypal-api";
import { paypalTools } from "./paypal-tools";

export interface SettlementResult {
  /**
   * created: the agent created and sent a new invoice; existing: this settlement was already invoiced;
   * resumed: a matching draft from an interrupted run was sent; conflict: an invoice with this number differs
   * from the current calculation (nothing sent); already_invoiced: listed in issued-invoices.json under an older
   * number (nothing created); no_invoice: zero shared energy and zero amount, nothing to bill (nothing looked up or
   * created); failed: no invoice (including invalid input, stopped before PayPal or Gemini).
   */
  outcome: "created" | "existing" | "resumed" | "conflict" | "already_invoiced" | "no_invoice" | "failed";
  invoiceId: string | null;
  invoice: PayPalInvoice | null;
  problems: string[];
  toolCalls: string[];
  model: string | null;
}

type Exec = (args: unknown, opts: unknown) => Promise<unknown>;

export interface ToolDeps {
  /** Toolkit tools for the agent (create, send, get). */
  base: ToolSet;
  /** Toolkit with create_invoice only, sending the invoice number as PayPal-Request-Id. */
  creator: ToolSet;
  getInvoice: (id: string) => Promise<PayPalInvoice>;
}

const realDeps = (invoiceNumber: string): ToolDeps => ({
  base: paypalTools({ invoices: { create: true, send: true, get: true } }),
  creator: paypalTools({ invoices: { create: true } }, invoiceNumber),
  getInvoice,
});

/**
 * Guardrails around the toolkit tools. Without them the agent, after PayPal refused a duplicate invoice number,
 * changed the number on its own and sent the neighbour a second bill. Now:
 * - create_invoice always sends our computed arguments (the model only decides to call it) and runs at most once;
 *   it uses the invoice number as PayPal-Request-Id, so a repeated create returns the first result;
 * - send_invoice only works for the invoice created in this run, and only after that invoice was read back and
 *   matches recipient, amount, currency and number (a repeated create may return an older invoice).
 * Exported for tests; `deps` replaces PayPal there.
 */
export function guardedTools(input: InvoiceInput, deps?: ToolDeps, signal?: AbortSignal) {
  const args = buildCreateInvoiceArgs(input);
  const checkedDeps = deps ?? realDeps(input.invoiceNumber);
  const { base, creator } = checkedDeps;
  const state = {
    attempts: 0,
    invoiceId: null as string | null,
    rejection: null as string | null,
    /** Problems that stopped sending; nothing was sent. */
    blocked: [] as string[],
  };
  const exec = (tools: ToolSet, name: string) => (tools[name] as unknown as { execute: Exec }).execute;
  const refuse = (message: string) => JSON.stringify({ ok: false, message });

  const tools: ToolSet = {
    ...base,
    create_invoice: tool({
      description: base.create_invoice.description,
      inputSchema: base.create_invoice.inputSchema,
      execute: async (_modelArgs, opts) => {
        signal?.throwIfAborted();
        if (++state.attempts > 1) return refuse("create_invoice may be called only once per run. Stop and report the error.");
        const out = JSON.stringify(await exec(creator, "create_invoice")(args, opts));
        state.invoiceId = out.match(/INV2-[A-Z0-9-]+/)?.[0] ?? null;
        // The toolkit returns PayPal errors as output ({ ok: false, status, message }), e.g. 422 "Invoice number is duplicate."
        if (!state.invoiceId) state.rejection = out.match(/"message\\?":\\?"([^"\\]+)/)?.[1] ?? out.slice(0, 200);
        return out;
      },
    }),
    send_invoice: tool({
      description: base.send_invoice.description,
      inputSchema: base.send_invoice.inputSchema,
      execute: async (modelArgs, opts) => {
        signal?.throwIfAborted();
        const id = (modelArgs as { invoice_id?: string }).invoice_id;
        if (!state.invoiceId || id !== state.invoiceId) return refuse("Only the invoice created in this run can be sent.");
        const d = decideExisting(await checkedDeps.getInvoice(id), input);
        if (d.action === "conflict") {
          state.blocked = d.problems;
          return refuse(`Not sent: the invoice differs from the settlement (${d.problems.join("; ")}). Stop and report this.`);
        }
        if (d.action === "reuse") return JSON.stringify({ ok: true, message: "Already sent earlier; nothing to do." });
        signal?.throwIfAborted();
        return exec(base, "send_invoice")(modelArgs, opts);
      },
    }),
  };
  return { tools, state };
}

/** An invoice with this settlement's number exists: reuse it, send it if it is a matching draft, or stop. */
async function handleExisting(
  inv: PayPalInvoice,
  input: InvoiceInput,
  toolCalls: string[],
  model: string | null,
  signal?: AbortSignal,
): Promise<SettlementResult> {
  const d = decideExisting(inv, input);
  if (d.action === "conflict") return { outcome: "conflict", invoiceId: inv.id, invoice: inv, problems: d.problems, toolCalls, model };
  if (d.action === "reuse") return { outcome: "existing", invoiceId: inv.id, invoice: inv, problems: [], toolCalls, model };
  try {
    signal?.throwIfAborted();
    await sendInvoice(inv.id);
  } catch (e) {
    // A concurrent run may have sent it in the meantime.
    const now = await getInvoice(inv.id);
    if (decideExisting(now, input).action === "reuse") return { outcome: "existing", invoiceId: inv.id, invoice: now, problems: [], toolCalls, model };
    return { outcome: "failed", invoiceId: inv.id, invoice: now, problems: [(e as Error).message], toolCalls, model };
  }
  const sent = await getInvoice(inv.id);
  return { outcome: "resumed", invoiceId: inv.id, invoice: sent, problems: verifyInvoice(sent, input), toolCalls, model };
}

/**
 * Settles one neighbour for one period, safe to re-run: the invoice number is fixed per settlement
 * (see settlementKey), an existing invoice is looked up first, and the producer's agent creates and sends
 * a new one through the PayPal Agent Toolkit only if none exists. Our code then reads the invoice back over
 * the REST API (not via the model) and checks every billed field.
 */
export async function settleWithAgent(input: InvoiceInput, signal?: AbortSignal): Promise<SettlementResult> {
  signal?.throwIfAborted();
  const check = classifyInvoiceInput(input);
  if (check.kind === "nothing_to_bill") {
    return { outcome: "no_invoice", invoiceId: null, invoice: null, problems: [], toolCalls: [], model: null };
  }
  if (check.kind === "invalid") {
    return { outcome: "failed", invoiceId: null, invoice: null, problems: check.problems, toolCalls: [], model: null };
  }
  const issued = findIssued(input.invoiceNumber);
  if (issued) {
    const problems = [`already invoiced as ${issued.invoiceNumber} (${issued.amountEur} €, ${issued.issued}); not issued again`];
    return { outcome: "already_invoiced", invoiceId: issued.invoiceId, invoice: null, problems, toolCalls: [], model: null };
  }
  const existing = await findInvoiceByNumber(input.invoiceNumber);
  if (existing) return handleExisting(existing, input, [], null, signal);

  const args = buildCreateInvoiceArgs(input);
  const run = await withModelFallback(async (model, name) => {
    signal?.throwIfAborted();
    const { tools, state } = guardedTools(input, undefined, signal); // fresh state if we fall back to another model
    const res = await generateText({
      model,
      tools,
      stopWhen: stepCountIs(6),
      maxRetries: 0,
      abortSignal: signal,
      prompt: [
        `You are the billing agent of ${input.producer.name}, a household that shares rooftop solar power with neighbours.`,
        `1. Call create_invoice with exactly these arguments (do not change any value):`,
        JSON.stringify(args),
        `2. Call send_invoice for the created invoice with send_to_recipient = true.`,
        `3. If any step fails, do not retry with other values; reply with the error.`,
        `4. Otherwise reply with one short English sentence confirming what you sent.`,
      ].join("\n"),
    });
    return { res, name, state };
  });

  const toolCalls = run.res.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
  const { invoiceId, rejection, blocked } = run.state;
  if (blocked.length) {
    return { outcome: "conflict", invoiceId, invoice: invoiceId ? await getInvoice(invoiceId) : null, problems: blocked, toolCalls, model: run.name };
  }

  if (!invoiceId) {
    // A concurrent run may have created this settlement's invoice first (PayPal: duplicate number): look again.
    const again = await findInvoiceByNumber(input.invoiceNumber);
    if (again) return handleExisting(again, input, toolCalls, run.name, signal);
    const problem = rejection ? `PayPal rejected the invoice: ${rejection}` : "agent did not create an invoice";
    return { outcome: "failed", invoiceId, invoice: null, problems: [problem], toolCalls, model: run.name };
  }
  const invoice = await getInvoice(invoiceId);
  const problems = verifyInvoice(invoice, input);
  if (invoice.status === "DRAFT") problems.push("invoice created but not sent; re-run to send it after checking");
  return { outcome: "created", invoiceId, invoice, problems, toolCalls, model: run.name };
}
