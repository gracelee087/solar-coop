"use client";

import { useState } from "react";
import type { MonthItem, MonthPlan, MonthReport } from "@/lib/monthly-settlement";
import type { RehearsalScenario } from "@/lib/monthly-rehearsal";

interface Rehearsal {
  label: string; first: MonthReport; replay: MonthReport; createdOnFirst: number; createdOnReplay: number;
}

function CaseEvidence({ item }: { item: MonthItem }) {
  const tags = [...new Map(item.evidence.map((tag) => [tag.kind, tag])).values()];
  return <details className="mt-2 rounded border border-sky-200 p-3 dark:border-sky-900">
    <summary className="cursor-pointer text-sm font-semibold">Case evidence · {item.name} · {item.caseId}</summary>
    <p className="my-2 text-xs">Energy-bill evidence only. Supplier costs, taxes and refunds remain unconnected; this is not a fully closed financial case. For zero usage, no invoice or payment evidence is required.</p>
    <div className="space-y-2">{tags.map((tag) => <details key={tag.id} className="rounded bg-white p-2 text-xs dark:bg-gray-900">
      <summary className="cursor-pointer"><strong>{tag.kind.replaceAll("_", " ")}</strong> · {tag.status.replaceAll("_", " ")} · {tag.environment.replaceAll("_", " ")}</summary>
      <p className="mt-2">{tag.note}</p>
      <p className="break-all">Source: {tag.source}</p>
      <p>Observed: {tag.observedAt}</p>
      <p className="break-all">Evidence ID: {tag.id}</p>
      <p className="break-all">Snapshot SHA-256: {tag.sha256}</p>
      <p className="break-all">Based on: {tag.dependsOn.join(", ") || "No parent evidence"}</p>
      {tag.snapshot !== null && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(tag.snapshot, null, 2)}</pre>}
    </details>)}</div>
    <p className="mt-2 text-xs">Checked means the stated code checks passed, not independent certification. Hashes identify snapshots; they do not authenticate an issuer. Earlier observations remain in the run report.</p>
  </details>;
}

export default function MonthlySettlementPanel({ plan, initialRehearsal, initialScenario = "normal" }: { plan: MonthPlan; initialRehearsal?: Rehearsal; initialScenario?: RehearsalScenario }) {
  const [scenario, setScenario] = useState<RehearsalScenario>(initialScenario);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Rehearsal | null>(initialRehearsal ?? null);
  const [error, setError] = useState("");
  async function rehearse() {
    setRunning(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/settlement-rehearsal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario }) });
      if (!res.ok) throw new Error(`Rehearsal failed (${res.status})`);
      setResult(await res.json());
    } catch (e) { setError((e as Error).message); }
    finally { setRunning(false); }
  }
  return (
    <section className="space-y-4 rounded-lg border border-sky-300 bg-sky-50 p-5 dark:border-sky-800 dark:bg-gray-950" aria-labelledby="monthly-title">
      <div>
        <h2 id="monthly-title" className="text-lg font-semibold">1. Monthly settlement desk</h2>
        <p className="mt-1 text-sm">Validate usage → apply saved terms → issue once → reconcile payment → record the result.</p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Target: no operator intervention for valid monthly bills. Customers still approve payments; automatic debit is not enabled.</p>
      </div>
      <div>
        <h3 className="text-sm font-semibold">Current June records — local preflight, no invoices issued</h3>
        <p className="my-2 text-xs"><a className="underline" href="/api/settlement-review?source=recorded&format=html" target="_blank" rel="noreferrer">Open evidence review packet</a> · <a className="underline" href="/api/settlement-review?source=recorded&format=json">Download records + evidence</a><br />Preparation for review only. Not a tax return; tax status, actual costs and refunds remain unassessed.</p>
        {plan.problems.map((p) => <p key={p} className="text-sm text-red-700">{p}</p>)}
        <ul className="mt-2 space-y-2 text-sm">
          {plan.items.map((i) => <li key={i.householdId}>
            <strong>{i.name}</strong> · {i.input ? `${(i.input.amountCents / 100).toFixed(2)} €` : "amount unavailable"} · <span className="font-mono">{i.state}</span>
            {i.problems.map((p) => <p key={p} className="text-xs text-amber-900 dark:text-amber-300">{p}</p>)}
            <CaseEvidence item={i} />
          </li>)}
        </ul>
      </div>
      <div className="border-t border-sky-200 pt-3 dark:border-sky-900">
        <h3 className="text-sm font-semibold">Try the workflow with simulated payments</h3>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Separate, empty test ledger using the saved prices and modelled energy. Scripted orchestration, no AI or PayPal calls. Customer payment is simulated. Existing records stay unchanged.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select aria-label="Settlement rehearsal scenario" value={scenario} disabled={running} onChange={(e) => { setScenario(e.target.value as RehearsalScenario); setResult(null); }} className="rounded border bg-white px-2 py-2 text-sm text-gray-900">
            <option value="normal">Valid month + repeat run</option>
            <option value="missing_agreement">Missing agreement</option>
            <option value="amount_mismatch">PayPal amount mismatch</option>
          </select>
          <button disabled={running} onClick={rehearse} className="rounded bg-sky-900 px-3 py-2 text-sm text-white disabled:opacity-50">{running ? "Running rehearsal…" : "Run offline rehearsal"}</button>
        </div>
        <div aria-live="polite">
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          {result && <div className="mt-3 space-y-2 text-sm">
            <p><strong>Simulated result:</strong> {result.first.paidCount} paid · {result.first.pendingCount} awaiting payment · {result.first.reviewRequired} need review.</p>
            <p>First run: {result.createdOnFirst} simulated invoices created. Repeat run: <strong>{result.createdOnReplay} additional invoices</strong>.</p>
            <ul>{result.first.items.map((i) => <li key={i.householdId}>{i.name}: <strong>{i.state}</strong>{i.problems.length ? ` — ${i.problems.join("; ")}` : ""}</li>)}</ul>
            {result.first.items.map((i) => <CaseEvidence key={i.caseId} item={i} />)}
            <details><summary className="cursor-pointer">Execution log</summary><ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">{result.first.events.map((e, i) => <li key={i}>{e.action}{e.householdId ? ` (${e.householdId})` : ""}: {e.detail}</li>)}</ol></details>
            <p className="text-xs text-gray-600 dark:text-gray-400">This verifies the workflow in simulation. It does not measure human time saved or prove live Gemini execution.</p>
          </div>}
        </div>
      </div>
    </section>
  );
}
