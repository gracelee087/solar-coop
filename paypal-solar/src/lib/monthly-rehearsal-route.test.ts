import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/settlement-rehearsal/route";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network forbidden"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("offline rehearsal endpoint", () => {
  it.each(["null", "[]", "{}", "bad JSON", '{"scenario":"constructor"}', '{"scenario":["normal"]}', '{"scenario":{}}', '{"scenario":"normal","issue":true}'])("rejects unsupported request %s", async (body) => {
    const res = await POST(new Request("http://localhost/api/settlement-rehearsal", { method: "POST", body }));
    expect(res.status).toBe(400);
  });
  it("returns clearly labelled simulation evidence", async () => {
    const res = await POST(new Request("http://localhost/api/settlement-rehearsal", { method: "POST", body: '{"scenario":"normal"}' }));
    const data = await res.json();
    expect(data.label).toContain("simulated");
    expect(data.first.execution).toBe("simulated");
    expect(data.createdOnReplay).toBe(0);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
