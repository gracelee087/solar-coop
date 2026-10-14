"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { HouseholdView, Outcome, ScopeItem } from "@/lib/dashboard";
import type { DashboardPageData } from "@/lib/dashboard-data";
import type { LiveStatusReport } from "@/lib/invoice-status";
import type { LiveNegotiation, Offer } from "@/lib/negotiation";
import { whatIf } from "@/lib/outcome";
import type { CostItem } from "@/lib/pricing";
import { defaultSettings } from "@/lib/tariffs";
import AllocationChart from "./allocation-chart";
import MonthlySettlementPanel from "./monthly-settlement-panel";

const eur = (cents: number) => `${(cents / 100).toFixed(2)} €`;
const signed = (cents: number) => `${cents >= 0 ? "+" : "−"}${(Math.abs(cents) / 100).toFixed(2)} €`;
const time = (iso: string) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");

/** Evidence tags shown next to claims, so readers can tell computed, sourced, assumed and agent-stated content apart. */
const TAGS = {
  computed: ["Computed", "bg-sky-100 text-sky-900"],
  source: ["Official source", "bg-emerald-100 text-emerald-900"],
  partial: ["Partly backed source", "bg-lime-100 text-lime-900"],
  assumption: ["Demo assumption", "bg-amber-100 text-amber-900"],
  agent: ["Agent statement, not verified", "bg-fuchsia-100 text-fuchsia-900"],
  expected: ["Expected, not confirmed", "bg-orange-100 text-orange-900"],
  recorded: ["As recorded", "bg-gray-200 text-gray-800"],
} as const;
type Tag = keyof typeof TAGS;

function Badge({ tag, children }: { tag: Tag; children?: ReactNode }) {
  const [label, cls] = TAGS[tag];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children ?? label}</span>;
}

function Section({ n, title, children, tag }: { n: number; title: string; children: ReactNode; tag?: Tag }) {
  return (
    <section className="rounded-lg border border-gray-200 p-5 dark:border-gray-800">
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
        <span className="text-gray-400">{n}.</span> {title} {tag && <Badge tag={tag} />}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value, strong, negative }: { label: string; value: string; strong?: boolean; negative?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <span className={`font-mono ${strong ? "text-base font-semibold" : ""} ${negative ? "text-red-600" : ""}`}>{value}</span>
    </div>
  );
}

function Link({ href }: { href?: string }) {
  if (!href) return <span className="text-gray-400">—</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">
      {new URL(href).hostname.replace(/^www\./, "")}
    </a>
  );
}

function CostTable({ title, rows }: { title: string; rows: CostItem[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      <table className="w-full text-xs">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="py-1 pr-2">Item</th>
            <th className="pr-2">Rate</th>
            <th className="pr-2">Applied to</th>
            <th className="pr-2 text-right">Month</th>
            <th className="pr-2">Paid by → received by</th>
            <th>Source / note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.label} className="border-t border-gray-100 align-top dark:border-gray-800">
              <td className="py-1 pr-2">{c.label}</td>
              <td className="pr-2">{c.rate}</td>
              <td className="pr-2">{c.appliedTo}</td>
              <td className="pr-2 text-right font-mono">{eur(c.cents)}</td>
              <td className="pr-2">
                {c.payer} → {c.receivedBy}
              </td>
              <td>
                <Link href={c.source.startsWith("http") ? c.source : undefined} />
                {!c.source.startsWith("http") && <span>{c.source}</span>}
                {c.note && <div className="text-gray-500">{c.note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScopeList({ items }: { items: ScopeItem[] }) {
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {items.map((s) => (
        <li key={s.label}>
          <span className="font-medium">{s.label}</span>: {s.cents === null ? "amount unknown" : eur(s.cents)}{" "}
          <span className={`rounded px-1 ${s.status === "unverified" ? "bg-amber-100 text-amber-900" : "bg-gray-200 text-gray-800"}`}>{s.status}</span>
          <div className="text-gray-500">
            {s.effect} {s.source && <Link href={s.source} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Results({ o, which, years }: { o: Outcome; which: "expected" | "settled"; years: string[] }) {
  const n = o.flows.neighbour;
  const p = o.flows.producer;
  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        {which === "expected" ? (
          <>
            <Badge tag="expected" /> Agreed price × expected shared energy: average of {years.length} June weather years ({years[0]}–{years.at(-1)}), each allocated on its own.
          </>
        ) : (
          <>
            <Badge tag="computed" /> Settlement on modelled supply: agreed price × shared energy modelled from June 2023 weather (PVGIS) and BDEW H25 profiles. Not metered.
          </>
        )}
      </p>
      <p className="mb-2 text-xs">
        {o.sharedKWh} kWh shared of {o.usedKWh} kWh used ({o.coveragePct} %)
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-900">
          <h3 className="mb-1 font-semibold">Neighbour: cost of the shared energy</h3>
          <Stat label="Paid to the producer (PayPal invoice)" value={eur(n.paidToProducerCents)} />
          <Stat label="Paid to the supplier on the same kWh" value={eur(n.otherCostsCents)} />
          <Stat label="Total for the shared energy" value={eur(n.totalCents)} />
          <Stat label="Same kWh from default supply (comparison)" value={eur(n.withoutSharingCents)} />
          <Stat label={n.savingCents >= 0 ? "Saving" : "Loss"} value={signed(n.savingCents)} strong negative={n.savingCents < 0} />
          <p className="mt-1 text-[11px] text-gray-500">Only the shared energy; not the household&apos;s whole electricity bill.</p>
        </div>
        <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-900">
          <h3 className="mb-1 font-semibold">Producer: income from this neighbour</h3>
          <Stat label="Invoice amount" value={eur(p.salesCents)} />
          <Stat label="PayPal and platform fees" value={signed(-p.deductionsCents)} />
          <Stat label="Net received" value={eur(p.netReceivedCents)} />
          <Stat label="Feed-in income for the same kWh (comparison)" value={eur(p.gridAlternativeCents)} />
          <Stat label={p.extraGainCents >= 0 ? "Extra gain" : "Loss"} value={signed(p.extraGainCents)} strong negative={p.extraGainCents < 0} />
        </div>
      </div>
    </div>
  );
}

type Live = { state: "loading" } | { state: "ok"; report: LiveStatusReport } | { state: "failed"; error: string; at: string };

/** Live sandbox status next to the recorded one; on failure the recorded status is shown and marked as such. */
function LiveStatus({ h, live, onCheck }: { h: HouseholdView; live: Live; onCheck: () => void }) {
  if (!h.issued) return null;
  const recorded = `${h.issued.statusAtRecord}, as recorded ${h.issued.issued}`;
  const item = live.state === "ok" ? live.report.items.find((i) => i.settlementKey === h.issued!.settlementKey) : undefined;
  let body: ReactNode;
  if (live.state === "loading") body = <span>Checking the PayPal sandbox…</span>;
  else if (live.state === "failed" || !item || item.status === null) {
    const at = live.state === "ok" ? live.report.checkedAt : live.state === "failed" ? live.at : "";
    const why = live.state === "failed" ? live.error : item?.error ?? "invoice not in the answer";
    body = (
      <span className="text-amber-800">
        Live check failed at {time(at)} ({why}). Showing the earlier record instead: {recorded}.
      </span>
    );
  } else {
    body = (
      <span>
        <Badge tag="computed">Live from PayPal sandbox</Badge> <span className="font-mono font-semibold">{item.status}</span>, {item.amountEur} € — checked {time(live.state === "ok" ? live.report.checkedAt : "")}
        {live.state === "ok" && live.report.cached ? " (cached answer, refreshed at most once a minute)" : ""}.{" "}
        {item.matchesRecord ? "Number and amount match the record." : <span className="text-red-600">Number or amount differs from the record.</span>}
      </span>
    );
  }
  return (
    <div className="mt-2 rounded bg-gray-50 p-2 text-xs dark:bg-gray-900">
      {body}{" "}
      <button onClick={onCheck} className="ml-1 rounded bg-gray-200 px-2 py-0.5 dark:bg-gray-800">
        check again
      </button>
      <div className="mt-1 text-gray-500">Read-only status check; it never creates, sends or changes an invoice.</div>
    </div>
  );
}

function OffersTable({ h, offers }: { h: HouseholdView; offers: Offer[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="py-1 pr-2">Round</th>
            <th className="pr-2">From</th>
            <th className="pr-2 text-right">Offer</th>
            <th className="pr-2 text-right">Moved</th>
            <th className="pr-2">Message and reason</th>
            <th>Proposed by</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((x, i) => (
            <tr key={i} className="border-t border-gray-100 align-top dark:border-gray-800">
              <td className="py-1 pr-2">{x.round}</td>
              <td className="pr-2">{x.from === "producer" ? h.demoSettings.producer.name : h.name}</td>
              <td className="pr-2 text-right font-mono">
                {x.priceCt.toFixed(2)} ct{x.adjusted && <div className="text-[10px] text-amber-700">clamped by code</div>}
              </td>
              <td className="pr-2 text-right font-mono">{x.concessionCt === null ? "—" : x.concessionCt.toFixed(2)}</td>
              <td className="pr-2">
                &ldquo;{x.message}&rdquo;
                {x.reason && <div className="text-gray-500">Reason: {x.reason}</div>}
              </td>
              <td>{x.source.kind === "gemini" ? x.source.model : `rule${x.source.reason ? ` (${x.source.reason})` : ""}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-gray-500">
        <Badge tag="agent" /> messages and reasons are the agents&apos; own words. <Badge tag="computed" /> &ldquo;Moved&rdquo; is computed from the offers.
      </p>
    </div>
  );
}

type LiveState =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; live: LiveNegotiation }
  /** Refused by the limits (429): nothing was started. */
  | { state: "refused"; message: string }
  /** Started or sent but did not return a result (server error, network). */
  | { state: "failed"; message: string };

/** Live Gemini negotiation for this household: a preview that is never saved and changes nothing else. */
function LiveNegotiationPanel({ h }: { h: HouseholdView }) {
  const [s, setS] = useState<LiveState>({ state: "idle" });
  const run = async () => {
    setS({ state: "running" });
    try {
      const res = await fetch("/api/negotiate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ householdId: h.id }) });
      const body = await res.json();
      if (res.status === 429) setS({ state: "refused", message: `${body.error ?? "Limit reached."}${body.retryAfterSec ? ` Try again in ${body.retryAfterSec} s.` : ""}` });
      else if (!res.ok) setS({ state: "failed", message: body.error ?? `status ${res.status}` });
      else setS({ state: "done", live: body as LiveNegotiation });
    } catch (e) {
      setS({ state: "failed", message: (e as Error).message });
    }
  };
  const live = s.state === "done" ? s.live : null;
  const preview = live?.result.priceCt != null ? whatIf(h, live.result.priceCt, defaultSettings) : null;
  return (
    <div className="mt-3 rounded-md border border-dashed border-gray-300 p-3 text-sm dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={run} disabled={s.state === "running"} className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-white dark:text-gray-900">
          {s.state === "running" ? "Negotiating live…" : "Run a live negotiation (preview)"}
        </button>
        <span className="text-xs text-gray-500">Gemini free tier; one run at a time, one per minute per visitor, a daily cap. Not saved.</span>
      </div>
      {s.state === "running" && <p className="mt-2 text-xs">The two agents are exchanging offers; this can take a minute or two.</p>}
      {s.state === "refused" && <p className="mt-2 text-xs text-amber-800">Not started: {s.message}</p>}
      {s.state === "failed" && <p className="mt-2 text-xs text-red-700">Failed: {s.message} Nothing was saved.</p>}
      {live && (
        <div className="mt-2">
          <p className="text-xs">
            <Badge tag="assumption">Live preview, not saved</Badge> {live.label}, {time(live.at)}.{" "}
            {live.result.agreed ? <span className="font-semibold">Agreed {live.result.priceCt} ct/kWh.</span> : <span>No agreement: {live.result.reason}</span>}{" "}
            The saved agreement{h.agreement ? ` (${h.agreement.priceCt} ct/kWh)` : ""}, the settlement and the invoices are unchanged.
          </p>
          {preview && (
            <p className="mt-1 text-xs">
              At this price: expected neighbour saving {signed(preview.expected.flows.neighbour.savingCents)}, producer extra gain {signed(preview.expected.flows.producer.extraGainCents)}; on modelled supply{" "}
              {signed(preview.settled.flows.neighbour.savingCents)} and {signed(preview.settled.flows.producer.extraGainCents)}. <Badge tag="computed" />
            </p>
          )}
          {live.result.offers.length > 0 && <OffersTable h={h} offers={live.result.offers} />}
        </div>
      )}
    </div>
  );
}

/** Price-only preview inside the window; never touches the agreement, the settlement or any invoice. */
function WhatIf({ h }: { h: HouseholdView }) {
  const start = h.deal?.priceCt ?? Math.round(((h.window.floorCt + h.window.ceilingCt) / 2) * 100) / 100;
  const [price, setPrice] = useState(start);
  const r = whatIf(h, price, defaultSettings);
  if (!h.window.viable) return null;
  const row = (label: string, o: { flows: Outcome["flows"] }) => (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="py-1 pr-2">{label}</td>
      <td className="pr-2 text-right font-mono">{eur(o.flows.neighbour.paidToProducerCents)}</td>
      <td className={`pr-2 text-right font-mono ${o.flows.neighbour.savingCents < 0 ? "text-red-600" : ""}`}>{signed(o.flows.neighbour.savingCents)}</td>
      <td className={`text-right font-mono ${o.flows.producer.extraGainCents < 0 ? "text-red-600" : ""}`}>{signed(o.flows.producer.extraGainCents)}</td>
    </tr>
  );
  return (
    <details className="mt-4 rounded-md border border-dashed border-gray-300 p-3 dark:border-gray-700">
      <summary className="cursor-pointer text-sm font-medium">What if the price were different? (preview only)</summary>
      <p className="mt-2 text-xs text-gray-500">
        <Badge tag="computed" /> Changes only the price, inside the window {h.window.floorCt}–{h.window.ceilingCt} ct/kWh, with the same energies. It does not change the saved agreement, the
        settlement or any invoice.
      </p>
      <label className="mt-2 flex items-center gap-3 text-sm">
        <input type="range" min={h.window.floorCt} max={h.window.ceilingCt} step={0.01} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="w-64" />
        <span className="font-mono">{price.toFixed(2)} ct/kWh</span>
        {h.deal && (
          <button onClick={() => setPrice(h.deal!.priceCt)} className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
            back to agreed {h.deal.priceCt} ct
          </button>
        )}
      </label>
      {r && (
        <table className="mt-2 w-full text-xs">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="py-1 pr-2">At {price.toFixed(2)} ct/kWh</th>
              <th className="pr-2 text-right">Invoice</th>
              <th className="pr-2 text-right">Neighbour saving</th>
              <th className="text-right">Producer extra gain</th>
            </tr>
          </thead>
          <tbody>
            {row(`Expected (${r.expected.sharedKWh} kWh)`, r.expected)}
            {row(`Modelled supply (${r.settled.sharedKWh} kWh)`, r.settled)}
          </tbody>
        </table>
      )}
    </details>
  );
}

function Household({ h, years, live, onCheck }: { h: HouseholdView; years: string[]; live: Live; onCheck: () => void }) {
  const [tab, setTab] = useState<"expected" | "settled">("settled");
  const d = h.deal;
  const o = d ? d[tab] : null;
  return (
    <div className="space-y-5">
      <Section n={2} title="Results">
        {!d || !o ? (
          <p className="text-sm">No agreed price, so there is nothing to settle. {h.negotiation.reason}</p>
        ) : (
          <>
            <div className="mb-3 flex gap-2 text-sm">
              {(["expected", "settled"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 ${tab === t ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "bg-gray-100 dark:bg-gray-800"}`}>
                  {t === "expected" ? "Expected (negotiation basis)" : "Replayed June (modelled)"}
                </button>
              ))}
            </div>
            <Results o={o} which={tab} years={years} />
          </>
        )}
        <WhatIf h={h} />
      </Section>

      {o && (
        <Section n={3} title="Cost details and what the totals leave out" tag="computed">
          <details>
            <summary className="cursor-pointer text-sm">Every line, with rate, quantity, who pays and the source (each total above is a sum of these lines)</summary>
            <CostTable title="① PayPal invoice: neighbour → producer" rows={[o.breakdown.invoice]} />
            <CostTable title="② Paid separately to the electricity supplier on the shared kWh" rows={o.breakdown.neighbourOtherCosts} />
            <CostTable title="Comparison basis for the neighbour (not a cost of sharing)" rows={[o.breakdown.neighbourAlternative]} />
            <CostTable title="③ Deducted from the producer's income" rows={o.breakdown.producerCosts} />
            <CostTable title="Comparison basis for the producer (forgone feed-in income, not an expense)" rows={[o.breakdown.producerAlternative]} />
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm">Not included or not verified ({h.scope.length})</summary>
            <ScopeList items={h.scope} />
          </details>
        </Section>
      )}

      <Section n={4} title="How the saved price was agreed (archive)">
        <details>
        <summary className="cursor-pointer text-sm">Recorded negotiation and optional preview — not part of monthly settlement</summary>
        <p className="mb-2 text-sm">
          {h.negotiationLabel}. Price window from the expected shared energy: {h.window.floorCt}–{h.window.ceilingCt} ct/kWh <Badge tag="computed" />
        </p>
        <p className="mb-2 text-xs text-gray-500">
          The AI agents propose prices, messages and reasons. Code keeps every offer inside both private limits and the window, computes how far each offer moved, and decides when the offers meet.
        </p>
        {h.negotiation.offers.length > 0 && <OffersTable h={h} offers={h.negotiation.offers} />}
        <p className="mt-2 text-sm">{h.negotiation.reason}</p>
        <LiveNegotiationPanel h={h} />
        <details className="mt-2">
          <summary className="cursor-pointer text-sm">For judges: goals and private limits</summary>
          <p className="mt-1 text-xs">
            <Badge tag="assumption" /> Fictional households. Neither agent is given the other side&apos;s private limit.
          </p>
          <ul className="mt-1 text-xs">
            {[h.demoSettings.producer, h.demoSettings.neighbour].map((p) => (
              <li key={p.name}>
                <span className="font-medium">{p.name}</span> — {p.limitKind} {p.limitCt} ct/kWh. Goal: {p.goal}
              </li>
            ))}
          </ul>
        </details>
        </details>
      </Section>

      <Section n={5} title="Agreement" tag={h.agreement ? "recorded" : undefined}>
        {h.agreement ? (
          <div className="text-sm">
            <Stat label="Agreed price" value={`${h.agreement.priceCt} ct/kWh`} strong />
            <Stat label="Month" value={h.agreement.period} />
            <Stat label="Parties" value={`${h.agreement.producer.name} → ${h.agreement.neighbour.name}`} />
            <Stat label="Allocation key" value={`${h.agreement.neighbour.allocationKey * 100} % of the fed-in surplus`} />
            <Stat label="Negotiated on" value={`${h.agreement.basis.expectedSharedKWh} kWh expected (${h.agreement.basis.weatherYears} weather)`} />
            <Stat label="Saved" value={time(h.agreement.agreedAt)} />
            <Stat label="Status of the price shown" value={h.agreementStatus} />
            {h.agreement.note && (
              <p className="mt-1 text-xs text-gray-500">
                <Badge tag="assumption" /> {h.agreement.note}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">The settlement reads only this record. A saved agreement is never overwritten.</p>
          </div>
        ) : (
          <p className="text-sm">No saved agreement for {h.name}; the price above is not saved and nothing can be settled from it.</p>
        )}
      </Section>

      <Section n={6} title="Settlement on modelled supply" tag="computed">
        {d ? (
          <div className="text-sm">
            <Stat label="Modelled shared energy" value={`${d.settled.sharedKWh} kWh`} />
            <Stat label="× agreed price" value={`${d.priceCt} ct/kWh`} />
            <Stat label="= Amount (new calculation, preview)" value={`${d.preview.amountEur} €`} strong />
            <Stat label="Expected (negotiation basis)" value={`${d.expected.sharedKWh} kWh → ${eur(d.expected.breakdown.invoice.cents)}`} />
            <p className="mt-2 text-xs">{d.facts}</p>
            <p className="mt-1 text-xs text-gray-500">
              Tip: {d.tip.text} {d.tip.model ? `(chosen by ${d.tip.model})` : "(default tip; no AI choice recorded)"}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              A worse month than expected stays a loss; the agreed price is not changed afterwards. This preview is never issued from this page.
            </p>
          </div>
        ) : (
          <p className="text-sm">Nothing to settle without an agreed price.</p>
        )}
      </Section>

      <Section n={7} title="PayPal invoice (sandbox)">
        {h.issued ? (
          <div className="text-sm">
            <p className="mb-2 text-xs">
              <Badge tag="recorded" /> Issued earlier in the PayPal sandbox with the values of that time, before the current price window and agreement. It is not issued again.
            </p>
            <Stat label="Invoice number" value={h.issued.invoiceNumber} />
            <Stat label="PayPal invoice ID" value={h.issued.invoiceId} />
            <Stat label="Amount" value={`${h.issued.amountEur} € (${h.issued.sharedKWh} kWh × ${h.issued.priceCt} ct)`} />
            <Stat label="Status at the time of the record" value={`${h.issued.statusAtRecord} (as recorded ${h.issued.issued})`} strong />
            <LiveStatus h={h} live={live} onCheck={onCheck} />
            <p className="mt-1 text-xs text-gray-500">This page has no button that issues invoices.</p>
          </div>
        ) : (
          <p className="text-sm">No invoice issued for this settlement. The amount above is a preview only.</p>
        )}
      </Section>
    </div>
  );
}

export default function Dashboard({ data }: { data: DashboardPageData }) {
  const { view, sources } = data;
  const [selected, setSelected] = useState(view.households[0].id);
  const h = view.households.find((x) => x.id === selected)!;
  const pt = view.producerTotal;
  const [live, setLive] = useState<Live>({ state: "loading" });
  const check = useCallback(async () => {
    setLive({ state: "loading" });
    try {
      const res = await fetch("/api/invoice-status", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setLive({ state: "ok", report: (await res.json()) as LiveStatusReport });
    } catch (e) {
      setLive({ state: "failed", error: (e as Error).message, at: new Date().toISOString() });
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 font-sans">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-amber-700">Simulation · fictional households · modelled energy data · PayPal sandbox, no real money</p>
        <h1 className="text-2xl font-bold">Neighbourhood solar sharing, Frankfurt — {view.periodLabel}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {view.producer.name}, {view.producer.kWp} kWp rooftop PV, shares its surplus with neighbours. The settlement agent uses saved prices, validated energy data and PayPal tools to manage monthly billing and payment checks.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {view.households.map((x) => (
            <button key={x.id} onClick={() => setSelected(x.id)} className={`rounded-full border px-3 py-1 text-sm ${x.id === selected ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900" : "border-gray-300"}`}>
              {x.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Shown: {h.name}, allocation key {h.key * 100} %, {h.annualKWh} kWh per year. Prices are taken from the saved agreements.
        </p>
      </header>

      <MonthlySettlementPanel plan={data.monthlyPlan} />
      <Household key={h.id} h={h} years={view.expectedYears} live={live} onCheck={check} />

      <Section n={8} title="Allocation every 15 minutes (modelled supply month)" tag="computed">
        <AllocationChart days={view.days} households={view.households} />
        <p className="mt-2 text-xs text-gray-500">
          Month: {view.month.generationKWh} kWh generated, {view.month.selfUseKWh} kWh own use, {view.month.surplusKWh} kWh unused surplus. Producer over all neighbours with a deal — expected extra
          gain {signed(pt.expected.flows.extraGainCents)}, settlement on modelled supply {signed(pt.settled.flows.extraGainCents)}.
        </p>
      </Section>

      <Section n={9} title="Sources, values used and who does what">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1 pr-2">Value</th>
                <th className="pr-2">Used</th>
                <th className="pr-2">Backing</th>
                <th className="pr-2">Validity in the source</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.key} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-2">{s.key}</td>
                  <td className="pr-2 font-mono">
                    {s.value} {s.unit}
                  </td>
                  <td className="pr-2">
                    <Badge tag={s.confidence === "confirmed" ? "source" : s.confidence === "partial" ? "partial" : "assumption"} />
                  </td>
                  <td className="pr-2">{s.validity}</td>
                  <td>
                    <Link href={s.source} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Energy data: {data.pvgisAttribution} (hourly PV, Frankfurt, weather years 2005–2023) and BDEW standard load profile H25. Sources checked 2026-10-13.
        </p>
        <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
          <div>
            <h4 className="font-semibold">AI (Gemini)</h4>
            <ul className="list-disc pl-4">
              <li>Calls guarded tools to issue, check and finish a monthly settlement (CLI agent mode)</li>
              <li>Historical price negotiation remains in the agreement archive</li>
              <li>Chooses which fixed tip goes with a bill</li>
              <li>Runs the settlement agent that calls the PayPal tools</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold">Code</h4>
            <ul className="list-disc pl-4">
              <li>Computes allocation, price window, costs, savings and amounts</li>
              <li>Keeps offers inside the limits and computes concessions</li>
              <li>Checks data for gaps, duplicates and invalid values</li>
              <li>Checks the agreement before saving and before settling</li>
              <li>Blocks duplicate invoices and compares every invoice before it is sent</li>
            </ul>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-gray-500">Demo inputs, not tax or legal advice.</p>
      </Section>
    </main>
  );
}
