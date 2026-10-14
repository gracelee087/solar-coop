import { MockLanguageModelV3 } from "ai/test";
import { aggregateCoopMonth, consumersOf, producersOf } from "./allocation";
import { settleMonth } from "./statements";
import type { CoopGroup, MeterInterval } from "./types";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/**
 * Scripted stand-in for the model, for offline rehearsals and tests: it calls the tools in the documented order and
 * writes fixed notes. The first consumer's note deliberately swaps two numbers, so the rehearsal shows the check
 * rejecting it and the code-built summary taking its place. This is not a model and proves nothing about one.
 */
export function scriptedCoopModel(group: CoopGroup, period: string, intervals: MeterInterval[]) {
  const s = settleMonth(group, aggregateCoopMonth(group, period, intervals));
  const bills = s.consumers.filter((c) => c.amountCents > 0);
  const payouts = s.producers.filter((p) => p.amountCents > 0);
  const ids = [...bills.map((c) => `bill-${c.statementId}`), ...payouts.map((p) => `payout-${p.statementId}`)];
  const eur = (c: number) => (c / 100).toFixed(2);
  const kwh = (wh: number) => (wh / 1000).toFixed(1);
  const notes = [
    ...bills.map((c, i) =>
      i === 0
        ? `Monthly bill of ${kwh(c.amountCents * 10)} kWh for ${eur(c.receivedWh / 10)} €.` // swapped on purpose
        : `Regular monthly bill: ${kwh(c.receivedWh)} kWh shared energy for ${eur(c.amountCents)} €. Nothing unusual.`,
    ),
    ...payouts.map((p) => `Producer payout for ${kwh(p.soldWh)} kWh shared: ${eur(p.amountCents)} €. Nothing unusual.`),
  ];
  const steps: [string, object][] = [
    ["calculate_settlement", { period }],
    ...consumersOf(group).map((c) => ["draft_invoice", { period, participantId: c.id }] as [string, object]),
    ...producersOf(group).map((p) => ["draft_payout", { period, participantId: p.id }] as [string, object]),
    ...ids.map((draftId) => ["request_approval", { draftId }] as [string, object]),
    ...ids.map((draftId, i) => ["add_approval_note", { draftId, note: notes[i] }] as [string, object]),
  ];
  return new MockLanguageModelV3({
    doGenerate: [
      ...steps.map(([toolName, input], i) => ({
        content: [{ type: "tool-call" as const, toolCallId: `call-${i}`, toolName, input: JSON.stringify(input) }],
        finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
        usage,
        warnings: [],
      })),
      { content: [{ type: "text" as const, text: "Done." }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] },
    ],
  });
}
