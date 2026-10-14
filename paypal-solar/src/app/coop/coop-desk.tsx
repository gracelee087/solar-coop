"use client";

import { useState } from "react";
import type { DeskItem, DeskView } from "@/lib/coop/desk";

const eur = (cents: number) => `${(cents / 100).toFixed(2)} €`;
const time = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

const STATUS: Record<string, [string, string]> = {
  pending_approval: ["Waiting for approval", "bg-amber-100 text-amber-900"],
  approved: ["Approved", "bg-emerald-100 text-emerald-900"],
  rejected: ["Rejected", "bg-red-100 text-red-900"],
  executing: ["Sending to PayPal sandbox", "bg-sky-100 text-sky-900"],
  executed: ["Sent via PayPal sandbox", "bg-sky-100 text-sky-900"],
  failed: ["Failed — check before retrying", "bg-red-100 text-red-900"],
};

function Card({ item, approver, busy, onDecide }: {
  item: DeskItem;
  approver: string;
  busy: boolean;
  onDecide: (draftId: string, decision: "approve" | "reject", reason?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [label, cls] = STATUS[item.status] ?? [item.status, "bg-gray-200 text-gray-800"];
  const canDecide = item.status === "pending_approval" && approver.trim() !== "" && !busy;
  return (
    <li className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="mr-2 text-xs uppercase tracking-wide text-gray-500">{item.kind === "bill" ? "Bill to" : "Payout to"}</span>
          <strong>{item.name}</strong>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg font-semibold">{item.amountEur} €</span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
        </div>
      </div>
      <p className="mt-1 font-mono text-xs text-gray-500">
        {item.kWh} kWh {item.kind === "bill" ? "received" : "shared"} · {item.sharePct} % of {item.totalKWh} kWh{" "}
        {item.kind === "bill" ? "used" : "fed in"} · {item.priceCt} ct/kWh
      </p>
      <p className="mt-3 text-sm">{item.summary}</p>
      <p className="mt-1 text-xs text-gray-500">
        {item.summarySource === "agent" ? "Note by the AI agent, numbers checked against the computed facts" : "Summary built by code"}
        {item.noteRejected && ` · the agent's note was rejected (${item.noteRejected})`}
      </p>
      {item.flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {item.flags.map((f) => (
            <li key={f.code} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">⚠ {f.message}</li>
          ))}
        </ul>
      )}
      {item.externalId && (
        <p className="mt-2 font-mono text-xs text-gray-500">PayPal {item.kind === "bill" ? "invoice" : "payout batch"} {item.externalId}</p>
      )}
      {item.reconciliation && (
        <p
          className={`mt-2 rounded px-2 py-1 text-xs font-medium ${
            item.reconciliation.status === "matched"
              ? "bg-emerald-50 text-emerald-900"
              : item.reconciliation.status === "pending"
                ? "bg-sky-50 text-sky-900"
                : "bg-red-50 text-red-900"
          }`}
        >
          {item.reconciliation.status === "matched" ? "✓ Reconciled" : item.reconciliation.status === "pending" ? "… Waiting" : "✗ Mismatch"}:{" "}
          {item.reconciliation.reason} · PayPal status {item.reconciliation.externalStatus} · checked {time(item.reconciliation.checkedAt)}
        </p>
      )}
      {item.decision && (
        <p className="mt-2 text-xs text-gray-500">
          {item.status === "rejected" ? "Rejected" : "Approved"} by {item.decision.by}, {time(item.decision.at)}
          {item.decision.reason && ` — ${item.decision.reason}`}
        </p>
      )}
      {item.status === "pending_approval" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!rejecting ? (
            <>
              <button
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                disabled={!canDecide}
                onClick={() => onDecide(item.draftId, "approve")}
              >
                Approve
              </button>
              <button
                className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40"
                disabled={!canDecide}
                onClick={() => setRejecting(true)}
              >
                Reject…
              </button>
            </>
          ) : (
            <div className="flex w-full flex-wrap gap-2">
              <input
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                placeholder="Reason (required)"
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                disabled={!canDecide || reason.trim() === ""}
                onClick={() => onDecide(item.draftId, "reject", reason)}
              >
                Reject
              </button>
              <button className="px-2 text-sm text-gray-500" onClick={() => setRejecting(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function CoopDesk({ initial }: { initial: DeskView }) {
  const [view, setView] = useState(initial);
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(draftId: string, decision: "approve" | "reject", reason?: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/coop/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: view.period, source: view.source, draftId, decision, by: approver, reason }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setView(body as DeskView);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Settlement {view.period}</h2>
          <span className="text-xs text-gray-500">
            {view.source === "agent"
              ? "Prepared by the AI agent"
              : view.source === "replay"
                ? "Prepared by the AI agent · replay of the run before approval, decisions here are never executed"
                : "Scripted offline rehearsal, not a model run"}
            {" · "}saved {time(view.savedAt)}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            // Settlement totals of all drafts, before and after execution: payment status is shown per card.
            ["Consumer bills (settlement)", eur(view.totals.billedCents)],
            ["Producer payouts (settlement)", eur(view.totals.payoutCents)],
            ["Operator share", eur(view.totals.operatorCents)],
          ].map(([k, v]) => (
            <div key={k} className="rounded bg-gray-50 p-3 dark:bg-gray-900">
              <dt className="text-xs text-gray-500">{k}</dt>
              <dd className="font-mono text-lg font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm">
          {view.counts.pending} waiting · {view.counts.approved} approved · {view.counts.rejected} rejected ·{" "}
          {view.counts.executed} sent via PayPal sandbox · {view.counts.matched} reconciled
        </p>
        {view.problems.map((p) => (
          <p key={p} className="mt-2 text-sm text-red-700">{p}</p>
        ))}
        <p className="mt-3 text-xs text-gray-500">
          Modelled June data (PVGIS weather, BDEW H25 load profile), not metered. Net amounts; VAT and PayPal fees not
          included. Approving records your decision only: payments are executed in a separate step, not from this page.
          &quot;Reconciled&quot; means PayPal reports the full settlement amount as paid (bills) or paid out (payouts).
        </p>
      </section>

      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Your name</span>
        <input
          className="w-72 max-w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
          value={approver}
          maxLength={60}
          placeholder="Required to approve or reject"
          onChange={(e) => setApprover(e.target.value)}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}

      {(["bill", "payout"] as const).map((kind) => (
        <section key={kind}>
          <h3 className="mb-2 font-semibold">{kind === "bill" ? "Consumer bills" : "Producer payouts"}</h3>
          <ul className="space-y-3">
            {view.items.filter((i) => i.kind === kind).map((i) => (
              <Card key={i.draftId} item={i} approver={approver} busy={busy} onDecide={decide} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
