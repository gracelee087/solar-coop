import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("./correction-extractor", () => ({ extractCorrection: vi.fn() }));
import { extractCorrection } from "./correction-extractor";
import { fixtureExtraction, correctionDocument } from "./correction-fixtures";
import { POST } from "../app/api/correction-demo/route";
const invoke = (body: unknown, host = "http://127.0.0.1:3196", origin = host) => POST(new Request(`${host}/api/correction-demo`, { method: "POST", headers: { origin }, body: JSON.stringify(body) }));
beforeEach(() => { vi.stubEnv("CORRECTION_LOCAL_AI", "1"); vi.mocked(extractCorrection).mockResolvedValue({ correction: fixtureExtraction, raw: JSON.stringify(fixtureExtraction), model: "test_mock", mode: "mock", elapsedMs: 1 }); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("executes inspect → approved simulated refund → confirmed status through the route", async () => {
  const r = await (await invoke({ action: "inspect", document: correctionDocument })).json();
  expect(r.state).toBe("awaiting_approval");
  const done = await (await invoke({ action: "approve", caseId: r.caseId, token: r.approvalToken })).json();
  expect(done.state).toBe("resolved"); expect(done.environment).toBe("simulated");
  expect((await (await invoke({ action: "check", caseId: r.caseId })).json()).differenceCents).toBe(0);
});
it("keeps pending separate from completed", async () => {
  const r = await (await invoke({ action: "inspect", document: correctionDocument, scenario: "pending" })).json();
  expect((await (await invoke({ action: "approve", caseId: r.caseId, token: r.approvalToken })).json()).state).toBe("refund_pending");
  expect((await (await invoke({ action: "simulate_completion", caseId: r.caseId })).json()).state).toBe("resolved");
});
it.each([null, [], { action: "inspect", document: "" }, { action: "inspect", document: correctionDocument, live: true }])("rejects malformed input without model calls", async (body) => {
  expect((await invoke(body)).status).toBe(400); expect(extractCorrection).not.toHaveBeenCalled();
});
it("rejects cross-origin or non-local use", async () => {
  expect((await invoke({}, "http://example.com")).status).toBe(403);
  expect((await invoke({}, "http://127.0.0.1:3196", "https://elsewhere.example")).status).toBe(403);
  expect(extractCorrection).not.toHaveBeenCalled();
});
it("requires explicit local-demo configuration", async () => {
  vi.stubEnv("CORRECTION_LOCAL_AI", "0"); expect((await invoke({ action: "inspect", document: correctionDocument })).status).toBe(403);
});
it("reports unavailable AI without substituting fixture results", async () => {
  vi.mocked(extractCorrection).mockRejectedValueOnce(new Error("offline"));
  expect((await invoke({ action: "inspect", document: correctionDocument })).status).toBe(502);
});
