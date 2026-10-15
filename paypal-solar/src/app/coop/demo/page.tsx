import { cookies } from "next/headers";
import { DEMO_COOKIE, demoBase, loadDemo } from "@/lib/coop/demo";
import { submissionWorkbench } from "@/lib/coop/submission-evidence";
import DemoWizard, { type ArchiveRow } from "./demo-wizard";
export const dynamic = "force-dynamic";

// Public demo: the visitor's own offline copy of the June month (fictional data, no PayPal or live AI call),
// shown one step per screen, with the archived PayPal sandbox observations as read-only context.
export default async function DemoPage() {
  const id = (await cookies()).get(DEMO_COOKIE)?.value;
  const archive: ArchiveRow[] = submissionWorkbench().items.map((i) => ({
    name: i.name,
    kind: i.kind,
    amountEur: i.amountEur,
    externalStatus: i.reconciliation?.externalStatus ?? "",
    matched: i.reconciliation?.status === "matched",
  }));
  return <DemoWizard initial={loadDemo(process.cwd(), demoBase(), id)} archive={archive} />;
}
