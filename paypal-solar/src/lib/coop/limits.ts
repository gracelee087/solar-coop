// Hard safety limits for every payment this prototype can execute. Deliberately constants, not settings.
export const MAX_PAYMENT_CENTS = 50_000; // 500 € per payment
export const MAX_DAILY_CENTS = 500_000; // 5,000 € per day, all executed payments together

/** Calendar day in Europe/Berlin (YYYY-MM-DD), the day the daily limit counts against. */
export function berlinDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function checkPaymentAmount(amountCents: number): string | null {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return "amount must be a positive whole number of cents";
  if (amountCents > MAX_PAYMENT_CENTS) return `amount ${amountCents} cents exceeds the 500 € per-payment limit`;
  return null;
}

export function checkDailyTotal(executedTodayCents: number, amountCents: number): string | null {
  if (executedTodayCents + amountCents > MAX_DAILY_CENTS) {
    return `daily total would reach ${executedTodayCents + amountCents} cents, above the 5,000 € daily limit`;
  }
  return null;
}

/**
 * Payment memos go to the payment provider, so they carry only the period and statement id (DSGVO data
 * minimisation): no energy quantities, meter readings or timestamps finer than the month.
 */
export function paymentMemo(kind: "bill" | "payout" | "refund", period: string, statementId: string): string {
  const what = kind === "bill" ? "Energy sharing bill" : kind === "payout" ? "Energy sharing payout" : "Energy sharing refund";
  const memo = `${what} ${period}, ref ${statementId}`;
  const problem = checkMemo(memo);
  if (problem) throw new Error(problem);
  return memo;
}

/** Rejects memo text that looks like meter detail: energy units or clock times. */
export function checkMemo(memo: string): string | null {
  if (/\b\d[\d.,]*\s*(k|m)?wh\b/i.test(memo) || /\bk?wh\b/i.test(memo)) return "memo must not contain energy quantities";
  if (/\b\d{1,2}:\d{2}\b/.test(memo)) return "memo must not contain interval times";
  return null;
}
