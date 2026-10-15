import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEMO_DRAFT, DEMO_LIMITS, demoAction, loadDemo, startDemo } from "./demo";

// Each test seeds a month on disk; under a full parallel run this can exceed the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

const root = process.cwd();
const E1 = "Fictional reply: the metering operator confirms 192.6 kWh for 2026-06, matching the meter file.";
let base: string;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External calls forbidden"); }));
  base = mkdtempSync(path.join(os.tmpdir(), "coop-demo-test-"));
});
afterEach(() => { rmSync(base, { recursive: true, force: true }); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

const h7 = (v: { items: { draftId: string }[] }) => v.items.find((i) => i.draftId === DEMO_DRAFT) as ReturnType<typeof loadDemo> extends infer V ? V extends { items: (infer I)[] } ? I : never : never;
const act = (id: string, action: string, extra: object = {}) => {
  const item = h7(loadDemo(root, base, id)!);
  return demoAction(root, base, id, { action, version: item.version, ...extra });
};

it("starts each visitor at the Haus 7 message, in separate folders", async () => {
  const a = await startDemo(root, base);
  const b = await startDemo(root, base);
  expect(a.id).not.toBe(b.id);
  expect(h7(a.view).work.messages).toHaveLength(1);
  expect(h7(a.view).work.topic).toBe("meter");
  act(a.id, "prepare");
  expect(h7(loadDemo(root, base, a.id)!).work.proposal).toBeDefined();
  expect(h7(loadDemo(root, base, b.id)!).work.proposal).toBeUndefined();
});

it("shows the saved real AI proposal only once the case equals the recorded input", async () => {
  const { id } = await startDemo(root, base);
  act(id, "prepare");
  let item = h7(loadDemo(root, base, id)!);
  expect(item.work.proposal!.source).toBe("template");
  expect(item.work.history.at(-1)!.detail).toMatch(/not used: this case differs/);
  act(id, "evidence", { origin: "metering_operator", text: E1 });
  act(id, "prepare");
  item = h7(loadDemo(root, base, id)!);
  expect(item.work.proposal!.source).toBe("agent");
  expect(item.work.proposal!.saved?.ranAt).toBe("2026-10-15T12:02:53.623Z");
  expect(item.work.history.at(-1)!.detail).toMatch(/No model was called/);
  act(id, "review", { text: "Checked the split against the bill check." });
  act(id, "explain", { text: "Sent the explanation." });
  act(id, "confirm", { text: "Customer confirmed by e-mail." });
  item = h7(loadDemo(root, base, id)!);
  expect(item.work.status).toBe("closed_customer_confirmed");
  expect(item.payment.status).toBe("not_sent");
});

it("does not use the saved proposal when the evidence text differs", async () => {
  const { id } = await startDemo(root, base);
  act(id, "evidence", { origin: "metering_operator", text: E1 + " Extra." });
  act(id, "prepare");
  expect(h7(loadDemo(root, base, id)!).work.proposal!.source).toBe("template");
});

it("cannot target another statement, change the operator name or approve payments", async () => {
  const { id } = await startDemo(root, base);
  const version = h7(loadDemo(root, base, id)!).version;
  expect(() => demoAction(root, base, id, { action: "prepare", version, draftId: "bill-ST-202606-H04" })).toThrow();
  expect(() => demoAction(root, base, id, { action: "prepare", version, by: "Someone" })).toThrow();
  expect(() => demoAction(root, base, id, { action: "approve", version })).toThrow();
  act(id, "evidence", { origin: "customer", text: "Photo of a reading." });
  expect(h7(loadDemo(root, base, id)!).work.evidence![0].by).toBe("Demo operator");
});

it("enforces the action limit, resets, and refuses unknown or expired sessions", async () => {
  const { id } = await startDemo(root, base);
  writeFileSync(path.join(base, id, "actions.json"), String(DEMO_LIMITS.actions));
  expect(() => act(id, "prepare")).toThrow(/action limit/);
  const again = await startDemo(root, base, id);
  expect(again.id).toBe(id);
  expect(h7(again.view).work.history).toHaveLength(1);
  expect(() => demoAction(root, base, "f".repeat(32), { action: "prepare", version: "x".repeat(64) })).toThrow(/expired/);
  expect(() => demoAction(root, base, "../outside", { action: "prepare", version: "x".repeat(64) })).toThrow(/expired/);
  expect(loadDemo(root, base, undefined)).toBeNull();
});
