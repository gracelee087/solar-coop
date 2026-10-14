import Link from "next/link";
import { runMonthlyRehearsal } from "@/lib/monthly-rehearsal";

export const dynamic = "force-dynamic";

export default async function EvidenceDemo() {
  const { first } = await runMonthlyRehearsal("normal");
  const item = first.items[0];
  // Without the BDEW H25 profile (not redistributed) the modelled month has no cases; explain instead of failing.
  if (!item) {
    return <main className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl font-bold">This earlier case view needs one public data file</h1>
      <p>It models June from the BDEW H25 load profile, which is not redistributed with the repository. Run <code>npm run fetch-data:h25</code> in <code>paypal-solar</code> and reload.</p>
      <p>The operator desk does not need it: <Link className="text-sky-700 underline" href="/coop?source=evidence">open the operator desk</Link>.</p>
    </main>;
  }
  const tags = [...new Map(item.evidence.map((tag) => [tag.kind, tag])).values()];
  return <main className="mx-auto max-w-6xl space-y-6 px-8 py-10">
    <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">Offline rehearsal · modelled energy · simulated payments</p>
    <h1 className="text-4xl font-bold">One case. Every available record.</h1>
    <p>Evidence is collected automatically by server tools. The AI tool loop is tested with a mock model; this page uses scripted orchestration.</p>
    <div className="grid grid-cols-3 gap-4 text-sm">
      <div className="rounded border p-4"><b>AI agent</b><p>Selects inspection, invoice and payment-check tools; routes unresolved cases to review.</p></div>
      <div className="rounded border p-4"><b>Code</b><p>Calculates charges, binds evidence to each case and blocks missing or mismatched proof.</p></div>
      <div className="rounded border p-4"><b>PayPal integration</b><p>Provides invoice/payment observations. Here, all payment responses are simulated.</p></div>
    </div>
    <section className="rounded-xl border bg-sky-50 p-6 text-gray-950">
      <h2 className="text-xl font-bold">{item.name} · {item.caseId}</h2>
      <p className="mb-4 text-sm">{first.items.length} cases automatically linked · Energy charge {(item.input!.amountCents / 100).toFixed(2)} EUR · simulated payment checked</p>
      <table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Evidence</th><th className="p-2">Status</th><th className="p-2">Source type</th></tr></thead><tbody>
        {tags.map((tag) => <tr key={tag.id} className="border-b"><td className="p-2">{tag.kind.replaceAll("_", " ")}</td><td className="p-2 font-semibold">{tag.status.replaceAll("_", " ")}</td><td className="p-2">{tag.environment.replaceAll("_", " ")}</td></tr>)}
      </tbody></table>
      <p className="mt-4 text-xs">Every collected tag includes a source, observation time, snapshot and hash. Supplier, tax and refund sources remain unconnected.</p>
    </section>
    <nav className="flex gap-5 text-sm underline"><Link href="/demo">Open full case evidence</Link><a href="/api/settlement-review?source=simulation&format=html">Open demo review packet</a><a href="/api/settlement-review?source=simulation&format=json">Download demo records</a></nav>
    <p className="text-xs">Review packets are preparation drafts, not tax filings. No real money, tax payment or refund is established.</p>
  </main>;
}
