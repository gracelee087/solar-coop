import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import Workbench from "./workbench";
import { submissionWorkbench } from "../../lib/coop/submission-evidence";
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
