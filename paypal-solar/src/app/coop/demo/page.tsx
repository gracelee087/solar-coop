import { cookies } from "next/headers";
import { DEMO_COOKIE, demoBase, loadDemo } from "@/lib/coop/demo";
import DemoWizard from "./demo-wizard";
export const dynamic = "force-dynamic";

// Public demo: the visitor's own offline copy of the June month (fictional data, no PayPal or live AI call),
// shown one step per screen.
export default async function DemoPage() {
  const id = (await cookies()).get(DEMO_COOKIE)?.value;
  return <DemoWizard initial={loadDemo(process.cwd(), demoBase(), id)} />;
}
