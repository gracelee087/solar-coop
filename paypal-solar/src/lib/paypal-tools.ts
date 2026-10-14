import { tool, type ToolSet } from "ai";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";

type Actions = ConstructorParameters<typeof PayPalAgentToolkit>[0]["configuration"]["actions"];

/**
 * PayPal Agent Toolkit tools for the current AI SDK.
 * The toolkit ships tools in the AI SDK v4 shape ({ parameters, execute }); current AI SDK expects
 * { inputSchema, execute } and handles Gemini's thought signatures in multi-step tool calls.
 * `requestId` is sent as PayPal-Request-Id on every request of this toolkit, so PayPal handles a repeated
 * request only once.
 */
export function paypalTools(actions: Actions, requestId?: string): ToolSet {
  const toolkit = new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: { actions, context: { sandbox: true, ...(requestId ? { request_id: requestId } : {}) } },
  });
  const legacy = toolkit.getTools() as Record<
    string,
    { description?: string; parameters: never; execute: (args: unknown) => Promise<unknown> }
  >;
  return Object.fromEntries(
    Object.entries(legacy).map(([name, t]) => [
      name,
      tool({ description: t.description, inputSchema: t.parameters, execute: (args) => t.execute(args) }),
    ]),
  );
}
