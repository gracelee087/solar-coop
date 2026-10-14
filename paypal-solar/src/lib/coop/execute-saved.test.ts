import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSavedDraft } from "./execute-saved";
import { PaymentLedger } from "./ledger";
import type { PaymentRail, RailRequest } from "./rail";
import { sampleCoop } from "./sample-group";
import { loadState, saveState, statePath, updateState } from "./state";

let dir: string;
let calls: RailRequest[];
const rail: PaymentRail = { name: "fake", execute: async (r) => (calls.push(r), { externalId: "X1", status: "SENT" }) };

/** Saved June run with two approved bills. */
function saveRun() {
  const l = new PaymentLedger(sampleCoop.participants, rail);
  for (const p of ["H04", "H05"]) {
    const id = l.draft({ kind: "bill", participantId: p, period: "2026-06", statementId: `ST-202606-${p}`, amountCents: 1000 }).id;
    l.requestApproval(id);
    l.approve(id, "operator");
  }
  saveState(dir, { period: "2026-06", savedAt: "t0", source: "agent", model: null, drafts: l.list(), queue: [], problems: [] });
}
const run = (draftId: string) =>
  executeSavedDraft({ dir, period: "2026-06", draftId, participants: sampleCoop.participants, rail });

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "coop-exec-"));
  calls = [];
  saveRun();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("state updates across processes", () => {
  it("keeps a decision saved by another process while a draft is executed", async () => {
    const stale = loadState(dir, "2026-06")!; // loaded before the web desk rejects H05
    updateState(dir, "2026-06", (cur) => {
      const l = PaymentLedger.restore(sampleCoop.participants, rail, cur!.drafts);
      l.reject("bill-ST-202606-H05", "web", "wrong amount");
      return { ...cur!, savedAt: "t1", drafts: l.list() };
    });
    expect(stale.drafts.find((d) => d.id === "bill-ST-202606-H05")!.status).toBe("approved");
    expect((await run("bill-ST-202606-H04")).status).toBe("executed");
    const s = loadState(dir, "2026-06")!;
    expect(s.drafts.find((d) => d.id === "bill-ST-202606-H04")!.status).toBe("executed");
    expect(s.drafts.find((d) => d.id === "bill-ST-202606-H05")!.status).toBe("rejected");
  });

  it("sends nothing when the draft was rejected after the executing process loaded it", async () => {
    // Reject between the executing process loading the state and calling the provider.
    const p = executeSavedDraft({
      dir, period: "2026-06", draftId: "bill-ST-202606-H05", participants: sampleCoop.participants,
      rail,
      now: () => {
        updateState(dir, "2026-06", (cur) => ({
          ...cur!, drafts: cur!.drafts.map((d) => (d.id === "bill-ST-202606-H05" ? { ...d, status: "rejected" as const } : d)),
        }));
        return new Date("2026-07-01T08:00:00Z");
      },
    });
    await expect(p).rejects.toThrow(/rejected in the saved state; not executing/);
    expect(calls).toHaveLength(0);
    expect(loadState(dir, "2026-06")!.drafts.find((d) => d.id === "bill-ST-202606-H05")!.status).toBe("rejected");
  });

  it("refuses to save while another process holds the lock, and clears a stale lock", () => {
    const lock = `${statePath(dir, "2026-06")}.lock`;
    writeFileSync(lock, "");
    expect(() => updateState(dir, "2026-06", (cur) => cur!)).toThrow(/another process/);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(updateState(dir, "2026-06", (cur) => ({ ...cur!, savedAt: "t2" })).savedAt).toBe("t2");
  });

  it("writes nothing when the change throws", () => {
    expect(() => updateState(dir, "2026-06", () => { throw new Error("no"); })).toThrow("no");
    expect(loadState(dir, "2026-06")!.savedAt).toBe("t0");
  });
});

describe("account-wide daily limit under concurrent execution", () => {
  it("lets only one of two months' executions use the last 500 € of the day", async () => {
    const at = () => new Date("2026-07-01T08:00:00Z");
    // 4,500 € already executed today in May.
    const may = new PaymentLedger(sampleCoop.participants, rail, at);
    for (let i = 0; i < 9; i++) {
      const id = may.draft({ kind: "bill", participantId: "H04", period: "2026-05", statementId: `M${i}`, amountCents: 50_000 }).id;
      may.requestApproval(id);
      may.approve(id, "operator");
      await may.execute(id);
    }
    saveState(dir, { period: "2026-05", savedAt: "t", source: "agent", model: null, drafts: may.list(), queue: [], problems: [] });
    for (const period of ["2026-06", "2026-07"]) {
      const l = new PaymentLedger(sampleCoop.participants, rail, at);
      const id = l.draft({ kind: "bill", participantId: "H05", period, statementId: `B-${period}`, amountCents: 50_000 }).id;
      l.requestApproval(id);
      l.approve(id, "operator");
      saveState(dir, { period, savedAt: "t", source: "agent", model: null, drafts: l.list(), queue: [], problems: [] });
    }
    calls = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const slowRail: PaymentRail = { name: "slow", execute: async (r) => (calls.push(r), await held, { externalId: "X", status: "SENT" }) };
    const exec = (period: string) =>
      executeSavedDraft({ dir, period, draftId: `bill-B-${period}`, participants: sampleCoop.participants, rail: slowRail, now: at });
    const june = exec("2026-06"); // reaches PayPal and waits there
    await new Promise((r) => setTimeout(r, 20));
    await expect(exec("2026-07")).rejects.toThrow(/5,000 €/);
    release();
    expect((await june).status).toBe("executed");
    expect(calls).toHaveLength(1);
    expect(loadState(dir, "2026-07")!.drafts[0].status).toBe("approved");
  });
});
