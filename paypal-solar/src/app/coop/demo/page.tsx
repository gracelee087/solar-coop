import { cookies } from "next/headers";
import { DEMO_COOKIE, demoBase, loadDemo } from "@/lib/coop/demo";
import { sampleCoop } from "@/lib/coop/sample-group";
import Workbench from "../workbench";
export const dynamic = "force-dynamic";

// Public demo: the visitor's own offline copy of the June month (fictional data, no PayPal or live AI call).
export default async function DemoPage() {
  const id = (await cookies()).get(DEMO_COOKIE)?.value;
  return (
    <Workbench
      initial={loadDemo(process.cwd(), demoBase(), id)}
      writable
      demo
      group={sampleCoop.participants.map(({ id, name, role }) => ({ id, name, role }))}
    />
  );
}
