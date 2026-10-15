import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEMO_DRAFT, demoAction, loadDemo, startDemo } from "../../../lib/coop/demo";
import DemoWizard, { evidenceText, firstOpenScreen, suggestedNote } from "./demo-wizard";

vi.setConfig({ testTimeout: 20_000 });
const root = process.cwd();
let base: string;
beforeEach(() => { base = mkdtempSync(path.join(os.tmpdir(), "coop-wizard-test-")); });
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

it("opens with the operator, the customer and the offline boundary in plain words", () => {
  const html = renderToStaticMarkup(<DemoWizard initial={null} />);
  expect(html).toContain("helps energy-sharing operators check bills, reconcile PayPal payments and handle customer disputes");
  expect(html).toContain("No PayPal call, no live AI call, nothing is sent");
  expect(html).toContain("Start the demo");
});

it("walks one screen per step and reaches the saved real AI proposal with the wizard's own texts", async () => {
  expect(firstOpenScreen(undefined, false)).toBe(1);
  const { id, view } = await startDemo(root, base);
  const h7 = () => loadDemo(root, base, id)!.items.find((i) => i.draftId === DEMO_DRAFT)!;
  const act = (action: string, extra: object = {}) => demoAction(root, base, id, { action, version: h7().version, ...extra });
  expect(firstOpenScreen(h7(), false)).toBe(2);
  const bill = renderToStaticMarkup(<DemoWizard initial={view} />);
  expect(bill).toContain("192.6 kWh");
  expect(bill).toContain("95.1 kWh");
  expect(bill).toContain("97.5 kWh");
  expect(firstOpenScreen(h7(), true)).toBe(3);
  act("evidence", { origin: "metering_operator", text: evidenceText(h7(), "2026-06") });
  expect(firstOpenScreen(h7(), true)).toBe(4);
  act("prepare");
  expect(h7().work.proposal!.saved).toBeDefined();
  expect(firstOpenScreen(h7(), true)).toBe(5);
  act("review", { text: suggestedNote(h7(), 5) });
  expect(firstOpenScreen(h7(), true)).toBe(6);
  act("explain", { text: suggestedNote(h7(), 6) });
  expect(firstOpenScreen(h7(), true)).toBe(7);
  act("confirm", { text: suggestedNote(h7(), 7) });
  expect(firstOpenScreen(h7(), true)).toBe(8);
  const finished = renderToStaticMarkup(<DemoWizard initial={loadDemo(root, base, id)} />);
  expect(finished).toContain("Done: the dispute is closed");
  expect(finished).toContain("Not sent · not paid");
  expect(finished).toContain("Start over");
});
