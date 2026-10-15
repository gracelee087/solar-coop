import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import Workbench from "./workbench";
import { submissionWorkbench } from "../../lib/coop/submission-evidence";
import { houseStatuses } from "../../lib/coop/house-status";
import { houseLabel, toMapHouses } from "./grid-map";
it("provides a useful first run with honest offline provenance", () => {
  const html = renderToStaticMarkup(<Workbench initial={null} />);
  expect(html).toContain("Start offline June rehearsal");
  expect(html).toContain("not an AI performance demonstration");
  expect(html).toContain("Group operator");
  expect(html).toContain("with AI agent");
});
it("disables setup on an unprotected production deployment", () => {
  const html = renderToStaticMarkup(
    <Workbench initial={null} writable={false} />,
  );
  expect(html).toContain("disabled");
  expect(html).toContain("Writing is disabled on this deployment");
});
it("discloses archived anonymized evidence and disables record refresh", () => {
  const html = renderToStaticMarkup(
    <Workbench initial={submissionWorkbench()} writable={false} snapshot />,
  );
  expect(html).toContain("ARCHIVED SANDBOX EVIDENCE");
  expect(html).toContain("No live PayPal lookup");
  expect(html).toMatch(/<button disabled="">↻ Refresh records<\/button>/);
});
it("shows the grid-area map, per-house chart and AI guide with honest labels", () => {
  const html = renderToStaticMarkup(
    <Workbench initial={submissionWorkbench()} writable={false} snapshot />,
  );
  expect(html).toContain("Fictional households · illustrative positions, not real addresses");
  expect(html).toContain("not an official balancing-area boundary");
  expect(html).toContain("© OpenStreetMap contributors");
  const h4 = toMapHouses(houseStatuses(submissionWorkbench().items)).find((h) => h.name === "Haus 4")!;
  expect(houseLabel(h4)).toBe("Haus 4 · consumer · Reconciled: Reconciled · amount and reference matched");
  expect(html).toContain("Outlier: more than 50% from the group median");
  expect(html).toContain("Saved AI agent output");
  expect(html).toContain("AI note · numbers checked; meaning still needs review.");
  expect(html).toContain("Checklist · computed by code, not AI");
});
it("turns a house red when a customer message is attached to its statement", () => {
  const view = submissionWorkbench();
  view.items.find((i) => i.name === "Haus 7")!.work.messages.push({
    id: "N1",
    text: "I paid by bank transfer.",
    by: "Test",
    at: "2026-10-15T10:00:00.000Z",
  });
  const h7 = toMapHouses(houseStatuses(view.items)).find((h) => h.name === "Haus 7")!;
  expect(houseLabel(h7)).toBe("Haus 7 · consumer · Settlement problem: Open customer case");
  expect(renderToStaticMarkup(<Workbench initial={view} />)).toContain("Customer case open");
});
