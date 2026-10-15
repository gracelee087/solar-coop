import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEMO_DRAFT, demoAction, loadDemo, startDemo } from "../../../lib/coop/demo";
import { submissionWorkbench } from "../../../lib/coop/submission-evidence";
import DemoWizard, { evidenceText, firstOpenScreen, suggestedNote } from "./demo-wizard";

vi.setConfig({ testTimeout: 20_000 });
const root = process.cwd();
let base: string;
beforeEach(() => { base = mkdtempSync(path.join(os.tmpdir(), "coop-wizard-test-")); });
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

it("opens with monthly settlement through PayPal and the offline boundary", () => {
  const html = renderToStaticMarkup(<DemoWizard initial={null} />);
  expect(html).toContain("Collect bills, pay producers, and reconcile community energy payments with PayPal.");
  expect(html).toContain("people approve payment actions");
  expect(html).toContain("No PayPal call, no live AI call, nothing is sent");
});

it("the archive behind the PayPal screen holds 7 paid invoices, 3 successful payouts and 10 matches", () => {
  const items = submissionWorkbench().items;
  expect(items.filter((i) => i.kind === "bill" && i.reconciliation?.externalStatus === "PAID")).toHaveLength(7);
  expect(items.filter((i) => i.kind === "payout" && i.reconciliation?.externalStatus === "SUCCESS")).toHaveLength(3);
  expect(items.filter((i) => i.reconciliation?.status === "matched")).toHaveLength(10);
});

it("walks the month first, then the Haus 7 case, one screen per step", async () => {
  expect(firstOpenScreen(undefined, 1)).toBe(1);
  const { id, view } = await startDemo(root, base);
  const h7 = () => loadDemo(root, base, id)!.items.find((i) => i.draftId === DEMO_DRAFT)!;
  const act = (action: string, extra: object = {}) => demoAction(root, base, id, { action, version: h7().version, ...extra });
  expect(firstOpenScreen(h7(), 1)).toBe(2);
  expect(firstOpenScreen(h7(), 2)).toBe(3);
  expect(firstOpenScreen(h7(), 3)).toBe(4);
  expect(firstOpenScreen(h7(), 4)).toBe(5);
  const month = renderToStaticMarkup(<DemoWizard initial={view} />);
  expect(month).toContain("7 bills · €102.38");
  expect(month).toContain("3 payouts · €94.50");
  act("evidence", { origin: "metering_operator", text: evidenceText(h7(), "2026-06") });
  expect(firstOpenScreen(h7(), 4)).toBe(6);
  act("prepare");
  expect(h7().work.proposal!.saved).toBeDefined();
  expect(firstOpenScreen(h7(), 4)).toBe(7);
  act("review", { text: suggestedNote(h7(), 7) });
  expect(firstOpenScreen(h7(), 4)).toBe(8);
  expect(suggestedNote(h7(), 8)).toContain("95.1 kWh shared solar on this bill, 97.5 kWh");
  act("explain", { text: suggestedNote(h7(), 8) });
  expect(firstOpenScreen(h7(), 4)).toBe(9);
  act("confirm", { text: suggestedNote(h7(), 9) });
  expect(firstOpenScreen(h7(), 4)).toBe(10);
  const completed = loadDemo(root, base, id)!;
  expect(completed.counts.readyToClose).toBe(false);
  expect(completed.counts.matched).toBe(0);
  const finished = renderToStaticMarkup(<DemoWizard initial={completed} />);
  expect(finished).toContain("the dispute is closed");
  expect(finished).not.toContain("the month is settled");
  expect(finished).toContain("did not settle a new month");
  expect(finished).toContain("Not sent · not paid");
  expect(finished).toContain("Start over");

  const operatorClosed = structuredClone(completed);
  operatorClosed.items.find((i) => i.draftId === DEMO_DRAFT)!.work.status = "closed_operator_reviewed";
  const operatorFinished = renderToStaticMarkup(<DemoWizard initial={operatorClosed} />);
  expect(operatorFinished).toContain("Closed after operator review · no customer confirmation");
  expect(operatorFinished).not.toContain("Closed · customer confirmed");
});
