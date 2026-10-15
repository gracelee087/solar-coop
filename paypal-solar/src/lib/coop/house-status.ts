import { CLOSED_STATUSES, type WorkItem } from "./workbench-types";

/** Display status of one household's statement, derived only from saved ledger, reconciliation and case records. */
export type HouseTone = "green" | "amber" | "red";
export interface HouseStatus {
  draftId: string;
  participantId: string;
  name: string;
  kind: WorkItem["kind"];
  tone: HouseTone;
  reason: string;
  kWh: number;
  eur: number;
  outlier: boolean;
  outlierReason?: string;
}

export const OUTLIER_BAND = { low: 0.5, high: 1.5 } as const;
export const OUTLIER_RULE =
  "Outlier: more than 50% from the group median (consumer kWh vs consumer median, producer kWh vs producer median). A display rule, not a finding.";

type StatusInput = Pick<WorkItem, "status" | "reconciliation" | "work" | "proposalStale"> & { chain?: WorkItem["chain"] };

/** An open case uses the same rule as the workbench counts: a closed payment claim reopens if the payment is no longer matched. */
export const hasOpenCase = (i: StatusInput) =>
  i.work.messages.length > 0 &&
  (!CLOSED_STATUSES.includes(i.work.status) || i.proposalStale ||
    (i.work.topic === "already_paid" && !(i.status === "executed" && i.reconciliation?.status === "matched")));

export function houseTone(i: StatusInput): { tone: HouseTone; reason: string } {
  const problems = [
    i.reconciliation?.status === "mismatch" && "Reconciliation mismatch",
    i.chain?.billStatus === "mismatch" && "Bill check mismatch",
    i.status === "failed" && "Execution outcome needs checking",
    i.status === "rejected" && "Rejected · no payment sent",
    hasOpenCase(i) && "Open customer case",
    i.proposalStale && "Investigation out of date",
  ].filter((p): p is string => !!p);
  if (problems.length) return { tone: "red", reason: problems.join(" · ") };
  if (i.status === "executed" && i.reconciliation?.status === "matched") return { tone: "green", reason: "Reconciled · amount and reference matched" };
  const waiting: Record<string, string> = {
    draft: "Draft · not yet in the approval queue",
    pending_approval: "Awaiting human approval",
    approved: "Approved · not executed",
    executing: "Execution in progress",
    executed: i.reconciliation?.status === "pending" ? "Sent · reconciliation pending" : "Sent · not reconciled yet",
  };
  return { tone: "amber", reason: waiting[i.status] ?? "Awaiting a check" };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface GroupMedians { bill: { kWh: number; eur: number }; payout: { kWh: number; eur: number } }

export function groupMedians(items: Pick<WorkItem, "kind" | "kWh" | "amountEur">[]): GroupMedians {
  const of = (kind: WorkItem["kind"]) => {
    const group = items.filter((i) => i.kind === kind);
    return { kWh: median(group.map((i) => Number(i.kWh))), eur: median(group.map((i) => Number(i.amountEur))) };
  };
  return { bill: of("bill"), payout: of("payout") };
}

/** Status and outlier flag per household. Consumers are compared with the consumer median, producers with the producer median. */
export function houseStatuses(items: WorkItem[]): HouseStatus[] {
  const medians = groupMedians(items);
  return items.map((i) => {
    const kWh = Number(i.kWh);
    const m = medians[i.kind].kWh;
    const outlier = m > 0 && (kWh < OUTLIER_BAND.low * m || kWh > OUTLIER_BAND.high * m);
    const pct = m > 0 ? Math.round(((kWh - m) / m) * 100) : 0;
    return {
      draftId: i.draftId, participantId: i.participantId, name: i.name, kind: i.kind,
      ...houseTone(i), kWh, eur: Number(i.amountEur), outlier,
      ...(outlier ? { outlierReason: `${i.kWh} kWh is ${pct > 0 ? "+" : ""}${pct}% from the ${i.kind === "bill" ? "consumer" : "producer"} median of ${m.toFixed(1)} kWh` } : {}),
    };
  });
}

export interface NextStep { text: string; done: boolean }

/** Checklist for one statement, computed from its saved state. Never calls a model. */
export function nextSteps(i: WorkItem): NextStep[] {
  const matched = i.status === "executed" && i.reconciliation?.status === "matched";
  const steps: NextStep[] = [
    { text: `Amount calculated in code: ${i.kWh} kWh · ${i.priceCt} ct/kWh`, done: true },
  ];
  if (i.status === "draft") steps.push({ text: "Put the draft into the approval queue", done: false });
  else if (i.status === "pending_approval") steps.push({ text: "A person approves or rejects this exact amount", done: false });
  else if (i.status === "rejected") steps.push({ text: "Rejected by a person · no payment sent; check the reason before drafting again", done: false });
  else steps.push({ text: `Human decision recorded${i.decision ? ` · ${i.decision.by}` : ""}`, done: true });
  if (i.status === "approved") steps.push({ text: "Execution is a separate CLI step · nothing sent yet", done: false });
  else if (i.status === "executing") steps.push({ text: "Wait for the execution outcome", done: false });
  else if (i.status === "failed") steps.push({ text: "Check the execution outcome in the provider record before any retry", done: false });
  else if (i.status === "executed") steps.push({ text: "Sent to the provider (sandbox)", done: true });
  if (i.status === "executed") {
    if (matched) steps.push({ text: "Reconciled · amount and reference matched", done: true });
    else if (i.reconciliation?.status === "mismatch") steps.push({ text: `Resolve the reconciliation mismatch: ${i.reconciliation.reason}`, done: false });
    else steps.push({ text: "Run the provider check (separate CLI workflow); sending is not proof of payment", done: false });
  }
  if (i.work.messages.length) {
    if (!i.work.proposal) steps.push({ text: "Prepare an offline investigation for the customer message", done: false });
    else if (i.proposalStale) steps.push({ text: "Prepare a fresh investigation · the statement or messages changed", done: false });
    else if (i.work.status === "open") steps.push({ text: "Record your review and what evidence you will check", done: false });
    else if (i.work.status === "investigating" && i.work.topic === "already_paid")
      steps.push({ text: matched ? "Close the case with a note · the payment is reconciled" : "Wait for payment evidence · a claim cannot mark the bill paid", done: false });
    else if (i.work.status === "investigating")
      steps.push({ text: i.chain?.billStatus === "match" ? "Send the explanation and record it · the bill check matches" : "The bill check does not confirm this bill · record a correction or an external check", done: false });
    else if (i.work.status === "waiting_external") steps.push({ text: "Waiting for an external answer · the case stays open", done: false });
    else if (i.work.status === "correction_needed") steps.push({ text: "A corrected statement is needed · the case stays open", done: false });
    else if (i.work.status === "explained_awaiting_reply") steps.push({ text: "Explanation sent · waiting for the customer's reply", done: false });
    else if (hasOpenCase(i)) steps.push({ text: "Case was closed but the payment is no longer matched · review again", done: false });
    else steps.push({ text: i.work.status === "closed_customer_confirmed" ? "Customer confirmed · case closed" : "Closed after operator review · no customer confirmation recorded", done: true });
  }
  return steps;
}
