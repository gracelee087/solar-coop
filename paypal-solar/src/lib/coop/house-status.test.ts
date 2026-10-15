import { describe, expect, it } from "vitest";
import { groupMedians, houseStatuses, houseTone, median, nextSteps } from "./house-status";
import { submissionWorkbench } from "./submission-evidence";
import type { WorkItem } from "./workbench-types";

const items = () => submissionWorkbench().items;
const byId = (list: WorkItem[], id: string) => list.find((i) => i.participantId === id)!;
const message = { id: "N1", text: "I paid by bank transfer.", by: "Test", at: "2026-10-15T10:00:00.000Z" };

describe("house status", () => {
  it("marks every reconciled statement of the archived June evidence green", () => {
    const s = houseStatuses(items());
    expect(s).toHaveLength(10);
    expect(s.every((h) => h.tone === "green")).toBe(true);
    expect(s.filter((h) => h.kind === "payout")).toHaveLength(3);
  });
  it("turns a household red when a customer message is attached, even if its payment is reconciled", () => {
    const list = items();
    byId(list, "H07").work.messages.push(message);
    const h7 = houseStatuses(list).find((h) => h.participantId === "H07")!;
    expect(h7.tone).toBe("red");
    expect(h7.reason).toContain("Open customer case");
  });
  it("keeps a resolved case green only while the payment stays matched", () => {
    const item = { ...byId(items(), "H07"), work: { topic: "already_paid" as const, messages: [message], status: "closed_operator_reviewed" as const, history: [] } };
    expect(houseTone(item).tone).toBe("green");
    expect(houseTone({ ...item, reconciliation: { ...item.reconciliation!, status: "mismatch" } })).toEqual({
      tone: "red", reason: "Reconciliation mismatch · Open customer case",
    });
  });
  it("uses red for rejected, failed and stale proposals and amber for waiting states", () => {
    const base = byId(items(), "H04");
    const plain = { ...base, reconciliation: undefined };
    expect(houseTone({ ...plain, status: "rejected" }).tone).toBe("red");
    expect(houseTone({ ...plain, status: "failed" }).tone).toBe("red");
    expect(houseTone({ ...base, proposalStale: true }).reason).toContain("Investigation out of date");
    expect(houseTone({ ...plain, status: "pending_approval" })).toEqual({ tone: "amber", reason: "Awaiting human approval" });
    expect(houseTone({ ...plain, status: "approved" }).reason).toBe("Approved · not executed");
    expect(houseTone({ ...plain, status: "executed" }).reason).toBe("Sent · not reconciled yet");
    expect(houseTone({ ...base, reconciliation: { ...base.reconciliation!, status: "pending" } }).tone).toBe("amber");
  });
});

describe("outlier rule", () => {
  it("computes medians per kind from the saved values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
    const m = groupMedians(items());
    expect(m.bill.kWh).toBe(120.8);
    expect(m.payout.kWh).toBe(246.4);
    expect(m.bill.eur).toBe(15.71);
  });
  it("finds no outlier in the archived June evidence", () => {
    expect(houseStatuses(items()).some((h) => h.outlier)).toBe(false);
  });
  it("flags consumers outside half to one and a half times the consumer median, producers against producers", () => {
    const list = items();
    byId(list, "H04").kWh = "40.0"; // below 0.5 × 120.8
    byId(list, "H05").kWh = "181.2"; // exactly 1.5 × median: not an outlier
    byId(list, "H01").kWh = "400.0"; // above 1.5 × producer median 246.4
    const s = houseStatuses(list);
    const h = (id: string) => s.find((x) => x.participantId === id)!;
    expect(h("H04").outlier).toBe(true);
    expect(h("H04").outlierReason).toBe("40.0 kWh is -67% from the consumer median of 120.8 kWh");
    expect(h("H05").outlier).toBe(false);
    expect(h("H01").outlier).toBe(true);
    expect(h("H01").outlierReason).toContain("producer median of 246.4 kWh");
  });
});

describe("next steps", () => {
  it("lists only completed steps for a reconciled statement without a case", () => {
    expect(nextSteps(byId(items(), "H04")).every((s) => s.done)).toBe(true);
  });
  it("asks for an investigation after a message and never offers to mark an unreconciled claim paid", () => {
    const item = byId(items(), "H07");
    item.work.messages.push(message);
    expect(nextSteps(item).at(-1)).toEqual({ text: "Prepare an offline investigation for the customer message", done: false });
    const waiting = { ...item, reconciliation: undefined, work: { ...item.work, topic: "already_paid" as const, status: "investigating" as const, proposal: { reason: "r", evidence: [], unverified: [], checks: [], replyDraft: "", source: "template" as const, basis: "b", at: "a" } } };
    expect(nextSteps(waiting).at(-1)!.text).toBe("Wait for payment evidence · a claim cannot mark the bill paid");
  });
  it("puts approval in a person's hands", () => {
    const item = { ...byId(items(), "H04"), status: "pending_approval" as const, decision: undefined, reconciliation: undefined };
    expect(nextSteps(item).map((s) => s.text)).toContain("A person approves or rejects this exact amount");
  });
});
