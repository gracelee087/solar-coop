import Link from "next/link";
import MonthlySettlementPanel from "../monthly-settlement-panel";
import { loadMonthlyPlan } from "@/lib/monthly-data";
import { runMonthlyRehearsal, type RehearsalScenario } from "@/lib/monthly-rehearsal";

export const dynamic = "force-dynamic";

/** A repeatable, read-only demo view. Every request uses a new isolated fake payment ledger. */
export default async function Demo({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const requested = (await searchParams).scenario;
  const scenario: RehearsalScenario = requested === "missing_agreement" || requested === "amount_mismatch" ? requested : "normal";
  const plan = loadMonthlyPlan();
  // Without the BDEW H25 profile (not redistributed) the modelled month has no cases; explain instead of showing a file error.
  if (!plan.items.length) {
    return <main className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl font-bold">This earlier demo needs one public data file</h1>
      <p>It models June from the BDEW H25 load profile, which is not redistributed with the repository. Run <code>npm run fetch-data:h25</code> in <code>paypal-solar</code> and reload.</p>
      <p>The operator desk does not need it: <Link className="text-sky-700 underline" href="/coop?source=evidence">open the operator desk</Link>.</p>
    </main>;
  }
  const result = await runMonthlyRehearsal(scenario);
  return <main className="mx-auto max-w-5xl space-y-5 px-6 py-8">
    <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">Offline demo · Modelled energy · Simulated payments</p>
    <h1 className="text-3xl font-bold">A month of shared electricity, checked.</h1>
    <p className="text-sm">This page runs an isolated rehearsal on the server and displays the result. No Gemini or PayPal calls, no record changes. It is not a recording of a button click or a live AI run.</p>
    <nav aria-label="Demo scenarios" className="flex flex-wrap gap-4 text-sm underline">
      <Link href="/demo?scenario=normal">Valid month + repeat</Link>
      <Link href="/demo?scenario=missing_agreement">Missing agreement</Link>
      <Link href="/demo?scenario=amount_mismatch">Amount mismatch</Link>
      <Link href="/demo/correction">Document correction + refund demo</Link>
      <Link href="/">Full dashboard</Link>
    </nav>
    <MonthlySettlementPanel key={scenario} plan={plan} initialRehearsal={result} initialScenario={scenario} />
  </main>;
}
