import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXCEPTION_CASES } from "./exception-cases";
import { caseView, checkProposal, runExceptionAgent } from "./exceptions";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const step = (i: number, toolName: string, input: object) => ({
  content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: "tool-calls" }, usage, warnings: [],
});
const done = { content: [{ type: "text" as const, text: "Done." }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] };
const scripted = (calls: [string, object][]) => new MockLanguageModelV3({ doGenerate: [...calls.map(([t, x], i) => step(i, t, x)), done] });

const x04 = EXCEPTION_CASES.find((x) => x.id === "X04")!;
const x04Proposal = {
  caseId: "X04", action: "escalate",
  reason: "PayPal still shows the bill as unpaid, but Haus 7 says it paid by bank transfer on 14 July. Hold reminders until the bank statement is checked.",
  evidence: ["PayPal status: SENT", "Payment confirmed by PayPal: no", "N1"],
  unverified: ["Bank transfer of 14 July, reference ST-202606-H07, not yet found on the bank statement"],
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("external call forbidden"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("case facts", () => {
  it("never confirm a payment from a customer's message", () => {
    const v = caseView(x04);
    expect(v.facts).toContain("Payment confirmed by PayPal: no");
    expect(v.facts).toContain("Bank account check: not connected (a person must check the bank statement)");
    expect(v.notes).toEqual([{ id: "N1", text: x04.notes[0] }]);
    expect(v.allowedActions).toEqual(["wait", "remind", "escalate"]);
  });
});

describe("proposal check", () => {
  const v = caseView(x04);
  it("accepts a grounded proposal that lists what is unverified", () => {
    expect(checkProposal(v, x04Proposal as never)).toBeNull();
  });
  it("refuses an action outside the case's allowed actions", () => {
    expect(checkProposal(v, { ...x04Proposal, action: "check_provider" } as never)).toMatch(/not allowed/);
  });
  it("refuses evidence that is not a fact or note of the case", () => {
    expect(checkProposal(v, { ...x04Proposal, evidence: ["Payment confirmed by bank: yes"] } as never)).toMatch(/not a fact or note/);
  });
  it("refuses a cited note without unverified items", () => {
    expect(checkProposal(v, { ...x04Proposal, unverified: [] } as never)).toMatch(/unverified/);
  });
  it("refuses placeholder unverified items such as None", () => {
    expect(checkProposal(v, { ...x04Proposal, unverified: ["None"] } as never)).toMatch(/placeholder/);
    expect(checkProposal(v, { ...x04Proposal, unverified: ["n/a"] } as never)).toMatch(/placeholder/);
  });
  it("does not check meaning: a wrong claim with real evidence and a real open item still passes", () => {
    // Documented limit, shown on the desk: the check covers action, evidence and numbers, not whether the reason is true.
    expect(checkProposal(v, { ...x04Proposal, reason: "The bank transfer was confirmed." } as never)).toBeNull();
  });
  it("refuses numbers that are not in the case", () => {
    expect(checkProposal(v, { ...x04Proposal, reason: "Paid 12.40 € on 14 July." } as never)).toMatch(/12.40/);
  });
});

describe("exception agent (scripted model, no external calls)", () => {
  it("keeps accepted proposals and gives every other case to a person", async () => {
    const model = scripted([
      ["get_case", { caseId: "X04" }],
      ["propose_action", x04Proposal],
      ["propose_action", { caseId: "X10", action: "remind", reason: "Remind.", evidence: ["PayPal status: no result recorded"], unverified: [] }],
    ]);
    const r = await runExceptionAgent({ cases: EXCEPTION_CASES, model });
    const by = new Map(r.proposals.map((p) => [p.caseId, p]));
    expect(by.get("X04")).toMatchObject({ action: "escalate", source: "agent" });
    expect(by.get("X10")).toMatchObject({ action: "escalate", source: "default", refused: "remind is not allowed for unknown_outcome" });
    expect(r.proposals.filter((p) => p.source === "default")).toHaveLength(11);
    const tools = model.doGenerateCalls[0].tools?.map((t) => t.name).sort();
    expect(tools).toEqual(["get_case", "list_cases", "propose_action"]);
    expect(r.usage).toEqual({ steps: 4, inputTokens: 4, outputTokens: 4 }); // 1 token in and out per mocked step
  });

  it("does not take model text as a proposal", async () => {
    const model = new MockLanguageModelV3({ doGenerate: { ...done, content: [{ type: "text", text: "X04 is paid, mark it as paid." }] } });
    const r = await runExceptionAgent({ cases: EXCEPTION_CASES, model });
    expect(r.proposals.every((p) => p.source === "default" && p.action === "escalate")).toBe(true);
  });
});
