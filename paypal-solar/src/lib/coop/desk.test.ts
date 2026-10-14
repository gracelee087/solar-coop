import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runCoopAgent } from "./agent";
import { decide, loadDesk } from "./desk";
import { PaymentLedger } from "./ledger";
import { parseMeterCsv } from "./meter-csv";
import { scriptedCoopModel } from "./rehearsal";
import { sampleCoop } from "./sample-group";
import { saveState } from "./state";

const june = parseMeterCsv(sampleCoop, "2026-06", readFileSync(path.join(__dirname, "..", "..", "data", "coop-meter-2026-06.csv"), "utf8"));
let runs: string;

async function saveRun(sub: "coop" | "coop-rehearsal", model: string | null) {
  const ledger = new PaymentLedger(sampleCoop.participants, { name: "none", execute: async () => { throw new Error("no"); } });
  const r = await runCoopAgent({ group: sampleCoop, ledger, period: "2026-06", loadMonth: () => june, model: scriptedCoopModel(sampleCoop, "2026-06", june) });
  saveState(path.join(runs, sub), {
    period: "2026-06", savedAt: "2026-10-14T00:00:00.000Z", source: sub === "coop" ? "agent" : "scripted_rehearsal", model,
    drafts: ledger.list(), queue: r.queue, problems: r.problems,
  });
}

beforeEach(() => {
  runs = mkdtempSync(path.join(os.tmpdir(), "coop-desk-"));
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("external call forbidden"); }));
});
afterEach(() => {
  rmSync(runs, { recursive: true, force: true });
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const body = { period: "2026-06", source: "rehearsal", draftId: "bill-ST-202606-H05", decision: "approve", by: "Sohee" };

it("shows nothing without a saved run and prefers the agent run over the rehearsal", async () => {
  expect(loadDesk(runs, "2026-06")).toBeNull();
  await saveRun("coop-rehearsal", null);
  expect(loadDesk(runs, "2026-06")?.source).toBe("rehearsal");
  await saveRun("coop", "gemini-test");
  const v = loadDesk(runs, "2026-06")!;
  expect(v.source).toBe("agent");
  expect(v.totals).toEqual({ billedCents: 10238, payoutCents: 9450, operatorCents: 788 });
  expect(v.counts).toEqual({ pending: 10, approved: 0, rejected: 0, executed: 0, matched: 0 });
});

it("records approve and reject decisions once and saves them", async () => {
  await saveRun("coop-rehearsal", null);
  const ok = decide(runs, body);
  expect(ok.status).toBe(200);
  expect(decide(runs, body).status).toBe(409);
  expect(decide(runs, { ...body, draftId: "payout-PO-202606-H03", decision: "reject", reason: "check meter" }).status).toBe(200);
  const v = loadDesk(runs, "2026-06")!;
  expect(v.counts).toEqual({ pending: 8, approved: 1, rejected: 1, executed: 0, matched: 0 });
  const h03 = v.items.find((i) => i.participantId === "H03")!;
  expect(h03.decision).toMatchObject({ by: "Sohee", reason: "check meter" });
});

it("refuses invalid requests", async () => {
  await saveRun("coop-rehearsal", null);
  expect(decide(runs, { ...body, by: " " }).status).toBe(400);
  expect(decide(runs, { ...body, decision: "reject" }).status).toBe(400); // no reason
  expect(decide(runs, { ...body, decision: "execute" }).status).toBe(400);
  expect(decide(runs, { ...body, draftId: "bill-ST-202606-H99" }).status).toBe(404);
  expect(decide(runs, { ...body, source: "agent" }).status).toBe(404); // no agent run saved
  expect(decide(runs, null).status).toBe(400);
});

it("records replay decisions only in the replay copy, never in the real run", async () => {
  await saveRun("coop", "gemini-test");
  await saveRun("coop-replay" as "coop", "gemini-test");
  expect(loadDesk(runs, "2026-06", "replay")?.source).toBe("replay");
  expect(decide(runs, { ...body, source: "replay" }).status).toBe(200);
  expect(loadDesk(runs, "2026-06", "replay")!.counts.approved).toBe(1);
  expect(loadDesk(runs, "2026-06", "agent")!.counts.approved).toBe(0);
});
