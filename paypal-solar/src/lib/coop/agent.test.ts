import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCoopAgent } from "./agent";
import { checkNote, flagsFor, type ApprovalFacts } from "./approval";
import { PaymentLedger } from "./ledger";
import { parseMeterCsv } from "./meter-csv";
import type { PaymentRail } from "./rail";
import { scriptedCoopModel } from "./rehearsal";
import { sampleCoop } from "./sample-group";
import { executedCentsOnDay, loadState, saveState } from "./state";

const june = parseMeterCsv(sampleCoop, "2026-06", readFileSync(path.join(__dirname, "..", "..", "data", "coop-meter-2026-06.csv"), "utf8"));
const loadMonth = () => june;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

function railSpy() {
  const calls: unknown[] = [];
  const rail: PaymentRail = { name: "spy", execute: async (r) => (calls.push(r), { externalId: "X", status: "SENT" }) };
  return { rail, calls };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("external call forbidden"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("monthly coop agent (scripted model, no external calls)", () => {
  it("puts every bill and payout in the approval queue without executing anything", async () => {
    const { rail, calls } = railSpy();
    const ledger = new PaymentLedger(sampleCoop.participants, rail);
    const model = scriptedCoopModel(sampleCoop, "2026-06", june);
    const r = await runCoopAgent({ group: sampleCoop, ledger, period: "2026-06", loadMonth, model });
    expect(r.complete).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.queue).toHaveLength(10);
    expect(ledger.list().every((d) => d.status === "pending_approval")).toBe(true);
    expect(calls).toHaveLength(0);
    const toolNames = Object.keys(model.doGenerateCalls[0].tools?.reduce((o, t) => ({ ...o, [t.name]: 1 }), {}) ?? {});
    expect(toolNames.sort()).toEqual(["add_approval_note", "calculate_settlement", "draft_invoice", "draft_payout", "request_approval"]);
  });

  it("replaces a note with swapped numbers by the code-built summary", async () => {
    const ledger = new PaymentLedger(sampleCoop.participants, railSpy().rail);
    const r = await runCoopAgent({ group: sampleCoop, ledger, period: "2026-06", loadMonth, model: scriptedCoopModel(sampleCoop, "2026-06", june) });
    const first = r.queue.find((q) => q.facts.participantId === "H04")!;
    expect(first.summarySource).toBe("default");
    expect(first.noteRejected).toMatch(/does not match/);
    expect(first.summary).toBe(
      "Bill to Haus 4 for 2026-06: 95.1 kWh shared energy (49 % of 192.6 kWh used) at 13.00 ct = 12.36 €. No flags.",
    );
    expect(r.queue.filter((q) => q.summarySource === "agent")).toHaveLength(9);
  });

  it("does not report completion from model text alone", async () => {
    const ledger = new PaymentLedger(sampleCoop.participants, railSpy().rail);
    const model = new MockLanguageModelV3({
      doGenerate: { content: [{ type: "text", text: "All drafts are queued." }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] },
    });
    const r = await runCoopAgent({ group: sampleCoop, ledger, period: "2026-06", loadMonth, model });
    expect(r.complete).toBe(false);
    expect(r.queue).toHaveLength(0);
    expect(r.problems).toContain("Not every bill and payout reached the approval queue");
  });

  it("records a model failure", async () => {
    const ledger = new PaymentLedger(sampleCoop.participants, railSpy().rail);
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error("model unavailable"); } });
    const r = await runCoopAgent({ group: sampleCoop, ledger, period: "2026-06", loadMonth, model });
    expect(r.complete).toBe(false);
    expect(r.problems[0]).toContain("model unavailable");
  });

  it("keeps human decisions on a re-run and creates no duplicate drafts", async () => {
    const ledger = new PaymentLedger(sampleCoop.participants, railSpy().rail);
    await runCoopAgent({ group: sampleCoop, ledger, period: "2026-06", loadMonth, model: scriptedCoopModel(sampleCoop, "2026-06", june) });
    ledger.approve("bill-ST-202606-H05", "operator");
    const again = PaymentLedger.restore(sampleCoop.participants, railSpy().rail, ledger.list());
    const r = await runCoopAgent({ group: sampleCoop, ledger: again, period: "2026-06", loadMonth, model: scriptedCoopModel(sampleCoop, "2026-06", june) });
    expect(r.complete).toBe(true);
    expect(again.list()).toHaveLength(10);
    expect(again.get("bill-ST-202606-H05").status).toBe("approved");
  });
});

describe("approval note check", () => {
  const f: ApprovalFacts = {
    draftId: "bill-ST-202606-H04", kind: "bill", participantId: "H04", name: "Haus 4", period: "2026-06",
    kWh: "95.1", totalKWh: "192.6", sharePct: "49", priceCt: "13.00", amountEur: "12.36", flags: [],
  };

  it("accepts numbers that match the facts with their units", () => {
    expect(checkNote(f, "Haus 4 (H04) received 95.1 kWh in 2026-06 at 13 ct: 12.36 EUR, 49 % of its use.")).toBeNull();
  });

  it("rejects swapped, invented or unit-less numbers", () => {
    expect(checkNote(f, "Bill of 12.36 kWh for 95.1 €.")).toMatch(/does not match/);
    expect(checkNote(f, "Bill of 13.36 €.")).toMatch(/does not match/);
    expect(checkNote(f, "About 3 times last month.")).toMatch(/without a matching unit/);
    expect(checkNote(f, "")).toBe("empty note");
  });

  it("flags are decided by code", () => {
    expect(flagsFor("bill", 0, 0, 0).map((x) => x.code)).toEqual(["no_consumption"]);
    expect(flagsFor("bill", 0, 5000, 0).map((x) => x.code)).toEqual(["nothing_received"]);
    expect(flagsFor("payout", 0, 9000, 0).map((x) => x.code)).toEqual(["no_shared_sales"]);
    expect(flagsFor("bill", 1000, 2000, 40_001).map((x) => x.code)).toEqual(["near_payment_limit"]);
    expect(flagsFor("bill", 1000, 2000, 40_000)).toEqual([]);
  });
});

describe("saved state", () => {
  it("round-trips and turns an interrupted execution into a failed draft", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "coop-state-"));
    try {
      const l = new PaymentLedger(sampleCoop.participants, railSpy().rail);
      const d = l.draft({ kind: "bill", participantId: "H04", period: "2026-06", statementId: "ST-202606-H04", amountCents: 1236 });
      saveState(dir, { period: "2026-06", savedAt: "t", source: "scripted_rehearsal", model: null, drafts: [{ ...d, status: "executing" }], queue: [], problems: [] });
      const s = loadState(dir, "2026-06")!;
      const restored = PaymentLedger.restore(sampleCoop.participants, railSpy().rail, s.drafts);
      expect(restored.get(d.id).status).toBe("failed");
      expect(restored.get(d.id).error).toMatch(/interrupted/);
      expect(loadState(dir, "2026-07")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds up today's executed payments of every other saved month", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "coop-state-"));
    try {
      const l = new PaymentLedger(sampleCoop.participants, railSpy().rail);
      const d = l.draft({ kind: "bill", participantId: "H04", period: "2026-05", statementId: "ST-202605-H04", amountCents: 1236 });
      const at = (executedAt: string, status: "executed" | "failed" | "approved") => ({ ...d, status, executedAt });
      const save = (period: string, drafts: ReturnType<typeof at>[]) =>
        saveState(dir, { period, savedAt: "t", source: "agent", model: null, drafts, queue: [], problems: [] });
      save("2026-05", [at("2026-10-14T09:00:00Z", "executed"), { ...at("2026-10-14T09:05:00Z", "failed"), id: "x" }, { ...at("2026-10-13T09:00:00Z", "executed"), id: "y" }]);
      save("2026-06", [at("2026-10-14T10:00:00Z", "executed")]);
      expect(executedCentsOnDay(dir, "2026-10-14", "2026-06")).toBe(2472); // executed + failed of May today; June excluded
      expect(executedCentsOnDay(dir, "2026-10-14", "2026-07")).toBe(3708);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
