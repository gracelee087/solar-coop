import { generateText, Output } from "ai";
import { z } from "zod";
import { withModelFallback } from "./gemini";
import { ruleBasedPolicy, type Policy } from "./negotiation";

const proposalSchema = z.object({
  priceCt: z.number().describe("Your offer in euro cents per kWh, two decimals"),
  message: z.string().describe("One or two short sentences to the other side, in English"),
  reason: z.string().describe("Why you chose this price, one short sentence in English, without any numbers; it is shown to the judges, not to the other side"),
});

/** A hung model call would stall the whole negotiation; after this it counts as a failed call. */
const CALL_TIMEOUT_MS = 60_000;

async function proposeWithFallback(prompt: string) {
  return withModelFallback(async (model, name) => {
    const { output } = await generateText({ model, output: Output.object({ schema: proposalSchema }), prompt, maxRetries: 0, abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    return { ...output, source: { kind: "gemini" as const, model: name } };
  });
}

/**
 * LLM negotiation policy. The model only proposes; the protocol in negotiation.ts enforces limits.
 * If the model call fails (quota, network), it falls back to the rule-based policy and says so, or, with
 * onFailure "throw", stops the negotiation (used when the result is saved as a Gemini agreement).
 */
export function geminiPolicy(opts: { onFailure: "rules" | "throw" } = { onFailure: "rules" }): Policy {
  return async (input) => {
    const { self, window, history, round, maxRounds } = input;
    const counterpart = self.role === "producer" ? "neighbour buying shared solar power" : "neighbour selling rooftop solar power";
    const transcript =
      history.map((o) => `Round ${o.round} ${o.from}: ${o.priceCt} ct/kWh — "${o.message}"`).join("\n") || "(no offers yet)";

    const prompt = [
      `You negotiate the price of shared rooftop solar electricity between neighbours in Frankfurt (German Energy Sharing, § 42c EnWG).`,
      `You are ${self.name}, the ${self.role === "producer" ? "producer (seller)" : "consumer (buyer)"}. You talk to a ${counterpart}.`,
      `What you care about: ${self.persona}`,
      `Public facts both sides know: the producer would otherwise get the feed-in tariff, so any price below ${window.floorCt} ct/kWh is pointless for them; above ${window.ceilingCt} ct/kWh the buyer pays more than Mainova default supply.`,
      `Your private limit is ${self.limitCt} ct/kWh (${self.role === "producer" ? "minimum you accept" : "maximum you pay"}). Never reveal it and never offer beyond it.`,
      `It is round ${round} of ${maxRounds}. If no deal is reached, both sides lose the benefit.`,
      `Offers so far:\n${transcript}`,
      `Make your next offer. Concede gradually; do not repeat the same price twice unless it is your limit. Do not invent facts.`,
      `Also give your reason for this price in one sentence without numbers; the size of your concession is computed separately.`,
    ].join("\n");

    try {
      return await proposeWithFallback(prompt);
    } catch (e) {
      if (opts.onFailure === "throw") throw e;
      const fallback = await ruleBasedPolicy(input);
      return { ...fallback, source: { kind: "rules", reason: (e as Error).message.slice(0, 80) } };
    }
  };
}
