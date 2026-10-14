import { executedCentsOn, PaymentLedger, type PaymentDraft } from "./ledger";
import { berlinDay, checkDailyTotal } from "./limits";
import type { PaymentRail } from "./rail";
import { accountLockPath, executedCentsOnDay, loadState, mergeDrafts, updateState, withLock } from "./state";
import type { Participant } from "./types";

/**
 * Executes one approved draft of a saved period. Right before the provider is called, under the account lock shared
 * by all months: the latest saved state is read again (if the draft was rejected meanwhile, nothing is sent), the
 * day's total across every month is checked against the daily limit, and the draft is saved as executing, which
 * counts against the limit while the provider is called. Only this draft is written back afterwards, so decisions
 * saved by other processes in between are kept.
 */
export async function executeSavedDraft(opts: {
  dir: string;
  period: string;
  draftId: string;
  participants: Participant[];
  rail: PaymentRail;
  now?: () => Date;
}): Promise<PaymentDraft> {
  const { dir, period, draftId } = opts;
  const state = loadState(dir, period);
  if (!state) throw new Error(`No saved state for ${period}`);
  const ledger = PaymentLedger.restore(opts.participants, opts.rail, state.drafts, opts.now);
  let stopped: Error | null = null;
  const reserve = (drafts: PaymentDraft[]) => {
    const executing = drafts.find((d) => d.id === draftId)!;
    try {
      withLock(accountLockPath(dir), "The operator account", () => {
        const day = berlinDay(new Date(executing.executedAt!));
        const otherMonths = executedCentsOnDay(dir, day, period);
        updateState(dir, period, (cur) => {
          const saved = cur?.drafts.find((d) => d.id === draftId);
          if (!cur || saved?.status !== "approved") throw new Error(`Draft ${draftId} is ${saved?.status ?? "missing"} in the saved state; not executing`);
          const problem = checkDailyTotal(otherMonths + executedCentsOn(cur.drafts, day), executing.amountCents);
          if (problem) throw new Error(`Execution refused: ${problem}`);
          return { ...cur, savedAt: new Date().toISOString(), drafts: mergeDrafts(cur.drafts, [executing]) };
        });
      });
    } catch (e) {
      stopped = e as Error;
      throw e; // the ledger then never calls the provider
    }
  };
  const done = await ledger.execute(draftId, reserve);
  if (stopped) throw stopped;
  updateState(dir, period, (cur) => ({ ...cur!, savedAt: new Date().toISOString(), drafts: mergeDrafts(cur!.drafts, [done]) }));
  return done;
}
