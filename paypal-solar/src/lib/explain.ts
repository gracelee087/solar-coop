import { generateText, Output } from "ai";
import { z } from "zod";
import { withModelFallback } from "./gemini";

/** The billed facts of one invoice, already rounded and formatted the way they appear. */
export interface ExplanationFacts {
  neighbour: string;
  producer: string;
  period: string; // e.g. "June 2026"
  usedKWh: string;
  sharedKWh: string;
  coveragePct: string;
  priceCt: string;
  amountEur: string;
  defaultSupplyCt: string;
  regulatedCt: string;
  savingEur: string;
  smartMeterEur: string;
}

/**
 * The sentences that carry numbers are built here, never by the model: a model can swap two valid numbers
 * (e.g. the amount and the saving, both in €) in a way no number check catches.
 */
export function factSentences(f: ExplanationFacts): string {
  return [
    `In ${f.period} your household used ${f.usedKWh} kWh, and ${f.sharedKWh} kWh of it (${f.coveragePct} %) came from ${f.producer}'s rooftop solar.`,
    `At the agreed price of ${f.priceCt} ct/kWh this costs ${f.amountEur} €.`,
    `Your supplier still bills about ${f.regulatedCt} ct/kWh in grid fees, levies and taxes on that energy, so compared with ${f.defaultSupplyCt} ct/kWh default supply you saved ${f.savingEur} € after the ${f.smartMeterEur} € smart-meter share.`,
  ].join(" ");
}

/**
 * Number-free tips, written and checked by hand. The model only chooses which one fits the month; it never writes
 * text that reaches the bill, so it cannot slip numbers in (digits, number words or other scripts).
 */
export const TIPS = {
  midday:
    "Solar panels produce most around midday, so running the washing machine or dishwasher then lets you use more of your neighbour's power.",
  timer:
    "Appliances with a delay timer can start on their own in the sunny middle of the day, even when nobody is at home.",
  evening:
    "The panels produce nothing in the evening and at night, so moving heavy use away from those hours helps most.",
  weather:
    "On cloudy days the roof produces less and your regular supplier covers the rest, so the shared part changes from month to month.",
} as const;

export type TipId = keyof typeof TIPS;
const TIP_IDS = Object.keys(TIPS) as [TipId, ...TipId[]];

/** Choice used when the model is unavailable. */
export const DEFAULT_TIP: TipId = "midday";

export interface Explanation {
  /** Code-built fact sentences followed by the chosen tip. */
  text: string;
  facts: string;
  tip: TipId;
  tipSource: "ai" | "default";
  model: string | null;
  error: string | null;
}

/** Explanation of one invoice: numbers from code; the model picks the most helpful tip from TIPS. */
export async function explainInvoice(f: ExplanationFacts): Promise<Explanation> {
  const facts = factSentences(f);
  const prompt = [
    `A household in Frankfurt with no energy background received this explanation of its monthly shared-solar invoice:`,
    facts,
    `Choose the one tip that helps this household most to use more of the neighbour's solar power next month:`,
    ...TIP_IDS.map((id) => `- ${id}: ${TIPS[id]}`),
  ].join("\n");

  try {
    const { tip, model } = await withModelFallback(async (m, name) => {
      const { output } = await generateText({
        model: m,
        prompt,
        output: Output.object({ schema: z.object({ tip: z.enum(TIP_IDS) }) }),
        maxRetries: 0,
      });
      return { tip: output.tip, model: name };
    });
    return { text: `${facts} ${TIPS[tip]}`, facts, tip, tipSource: "ai", model, error: null };
  } catch (e) {
    const error = (e as Error).message.slice(0, 120);
    return { text: `${facts} ${TIPS[DEFAULT_TIP]}`, facts, tip: DEFAULT_TIP, tipSource: "default", model: null, error };
  }
}
