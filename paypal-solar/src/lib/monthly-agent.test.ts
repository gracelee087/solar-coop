import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMonthlyAgent } from "./monthly-agent";
import { loadMonthlyPlan } from "./monthly-data";
import { createMonthSession } from "./monthly-settlement";
import { simulatedMonthDeps } from "./monthly-rehearsal";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const sequence = [
  ["inspect_month", {}],
  ...["h1", "h2", "h3"].flatMap((householdId) => [["issue_invoice", { householdId }], ["check_payment", { householdId }]]),
  ["finish_month", {}],
] as [string, object][];
const modelFor = (steps: [string, object][]) => new MockLanguageModelV3({ doGenerate: steps.map(([toolName, input], i) => ({
  content: [{ type: "tool-call" as const, toolCallId: `call-${i}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: "tool-calls" }, usage, warnings: [],
})) });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("external call forbidden"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("AI SDK monthly tool loop (mock model, no external calls)", () => {
  it("executes the full tool sequence and derives completion from verified tool results", async () => {
    const fake = simulatedMonthDeps();
    const session = createMonthSession(loadMonthlyPlan("empty_simulated_ledger"), fake.deps);
    const model = modelFor(sequence);
    const result = await runMonthlyAgent(session, model);
    expect(result).toMatchObject({ finished: true, paidCount: 3, reviewRequired: 0 });
    expect(fake.created()).toBe(3);
    expect(model.doGenerateCalls).toHaveLength(8);
    for (const item of result.items) {
      expect(item.evidence.some((e) => e.kind === "payment" && e.status === "checked" && e.environment === "simulated")).toBe(true);
      expect(item.evidence.some((e) => e.kind === "tax_refund" && e.status === "not_connected")).toBe(true);
    }
  });
  it("refuses to turn unsupported model claims into a completed or paid month", async () => {
    const fake = simulatedMonthDeps();
    const model = new MockLanguageModelV3({ doGenerate: {
      content: [{ type: "text", text: "All invoices are paid; everything is complete." }],
      finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [],
    } });
    const r = await runMonthlyAgent(createMonthSession(loadMonthlyPlan("empty_simulated_ledger"), fake.deps), model);
    expect(r.finished).toBe(false); expect(r.paidCount).toBe(0); expect(fake.created()).toBe(0);
    expect(r.problems[0]).toContain("before completing");
  });
  it("recovers from a rejected unknown household tool call without charging it", async () => {
    const fake = simulatedMonthDeps();
    const r = await runMonthlyAgent(createMonthSession(loadMonthlyPlan("empty_simulated_ledger"), fake.deps), modelFor([["issue_invoice", { householdId: "constructor" }], ...sequence]));
    expect(r.paidCount).toBe(3); expect(fake.created()).toBe(3);
  });
  it("does not call the model when preflight has already blocked every household", async () => {
    const fake = simulatedMonthDeps(), model = modelFor(sequence);
    const r = await runMonthlyAgent(createMonthSession(loadMonthlyPlan(), fake.deps), model);
    expect(r.reviewRequired).toBe(3); expect(model.doGenerateCalls).toHaveLength(0); expect(fake.created()).toBe(0);
  });
  it("records model failure without silently restarting the transaction loop", async () => {
    const fake = simulatedMonthDeps();
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error("model unavailable"); } });
    const r = await runMonthlyAgent(createMonthSession(loadMonthlyPlan("empty_simulated_ledger"), fake.deps), model);
    expect(r.finished).toBe(false); expect(r.problems[0]).toContain("model unavailable");
    expect(model.doGenerateCalls).toHaveLength(1); expect(fake.created()).toBe(0);
  });
  it("propagates the deadline to a running billing tool and leaves the month unfinished", async () => {
    const fake = simulatedMonthDeps();
    let sawAbort = false;
    fake.deps.settle = async (_input, signal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      sawAbort = signal.aborted;
      signal.throwIfAborted();
      throw new Error("unreachable");
    };
    const session = createMonthSession(loadMonthlyPlan("empty_simulated_ledger"), fake.deps);
    const result = await runMonthlyAgent(session, modelFor([["issue_invoice", { householdId: "h1" }]]), { timeoutMs: 30 });
    expect(sawAbort).toBe(true);
    expect(session.signal.aborted).toBe(true);
    expect(result).toMatchObject({ finished: false, paidCount: 0 });
    expect(result.problems).toContain("Agent deadline exceeded");
    expect(fake.created()).toBe(0);
    await session.issue("h2");
    expect(session.report().items[1].state).toBe("ready");
  });
});
