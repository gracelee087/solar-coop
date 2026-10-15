"use client";
import { useState } from "react";
import Link from "next/link";
import { EVIDENCE_SOURCES, type CaseStatus, type DisputeTopic, type EvidenceSource, type WorkbenchView, type WorkItem } from "../../lib/coop/workbench-types";
import { groupMedians, hasOpenCase, houseStatuses, OUTLIER_RULE } from "../../lib/coop/house-status";
import AppShell from "./app-shell";
import GridMap, { toMapHouses, type MapHouse } from "./grid-map";
import HouseChart from "./house-chart";
import AiGuide from "./ai-guide";
import styles from "./workbench.module.css";

const eur = (cents: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
const date = (value: string) =>
  new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";
type CaseAction = "message" | "prepare" | "review" | "evidence" | "hold" | "explain" | "confirm" | "close";
const DAY_MS = 24 * 60 * 60 * 1000;
// Same values as src/lib/coop/demo.ts (not imported: that module uses the file system).
const DEMO_DRAFT = "bill-ST-202606-H07";
const DEMO_NAME = "Demo operator";
const caseLabel: Record<CaseStatus, string> = {
  open: "Open · review the investigation",
  investigating: "Investigating",
  waiting_external: "Waiting for an external answer · open",
  correction_needed: "Correction needed · new statement pending · open",
  explained_awaiting_reply: "Explanation sent · waiting for the customer's reply",
  closed_operator_reviewed: "Closed after operator review · no customer confirmation",
  closed_customer_confirmed: "Closed · customer confirmed",
};
const topicLabel: Record<DisputeTopic, string> = {
  amount: "Bill amount",
  meter: "Metered energy",
  already_paid: "Says already paid",
};
const paymentShort: Record<WorkItem["payment"]["status"], string> = {
  not_sent: "Not sent · not paid",
  sent_not_checked: "Sent · payment not checked",
  sent_unpaid: "Sent · not paid",
  paid: "Paid · reconciled",
  provider_mismatch: "Provider record mismatch",
  failed: "Send failed · check",
};
const linkLabel = { match: "MATCH", mismatch: "MISMATCH", not_comparable: "NOT COMPARABLE", pending: "OPEN" } as const;
const kwh = (wh: number) => (wh / 1000).toFixed(1);
const stateLabel = (item: WorkItem) =>
  item.reconciliation?.status === "matched"
    ? "Paid · reconciled"
    : {
        draft: "Draft",
        pending_approval: "Needs approval",
        approved: "Approved · not sent",
        rejected: "Rejected",
        executing: "Execution in progress",
        executed: "Sent · not confirmed paid",
        failed: "Check execution outcome",
      }[item.status];

export default function Workbench({
  initial,
  writable = true,
  snapshot = false,
  demo = false,
  group = [],
}: {
  initial: WorkbenchView | null;
  writable?: boolean;
  snapshot?: boolean;
  /** Public per-visitor demo: only the Haus 7 case can be changed, the operator name is fixed. */
  demo?: boolean;
  /** Households of the modelled rehearsal group, shown as a preview before the month is calculated. */
  group?: { id: string; name: string; role: "producer" | "consumer" }[];
}) {
  const [view, setView] = useState(initial);
  const [selected, setSelected] = useState(
    initial?.items.find((i) => i.work.messages.length)?.draftId ??
      initial?.items[0]?.draftId ??
      "",
  );
  const [filter, setFilter] = useState("all");
  const [by, setBy] = useState(demo ? DEMO_NAME : "");
  const [message, setMessage] = useState("");
  const [topic, setTopic] = useState<DisputeTopic>("meter");
  const [evOrigin, setEvOrigin] = useState<EvidenceSource>("metering_operator");
  const [evRef, setEvRef] = useState("");
  const [evText, setEvText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const item =
    view?.items.find((i) => i.draftId === selected) ?? view?.items[0];
  const readOnly = snapshot || !writable || (demo && item?.draftId !== DEMO_DRAFT);
  const canWrite = !readOnly && !!by.trim() && !busy;
  const period = view?.desk.period ?? "2026-06";
  const month = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}-01T00:00:00Z`));
  const source = view?.desk.source ?? "rehearsal";

  async function request(url: string, body?: object): Promise<WorkbenchView> {
    const response = await fetch(
      url,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? "The request could not be completed");
    return data as WorkbenchView;
  }
  async function act(action: "start_rehearsal" | "reset_demo" | CaseAction, hold?: "external" | "correction") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await request(
        demo ? "/api/coop/demo" : "/api/coop/workbench",
        action === "start_rehearsal" || action === "reset_demo"
          ? { action: demo ? (action === "reset_demo" ? "reset" : "start") : action }
          : {
              action,
              ...(demo ? {} : { period, source, draftId: item!.draftId, by }),
              version: item!.version,
              text: action === "message" ? message : action === "evidence" ? evText : action === "prepare" ? undefined : note,
              ...(action === "evidence" ? { origin: evOrigin, ...(evRef.trim() ? { reference: evRef } : {}) } : {}),
              ...(action === "message" && !item!.work.messages.length ? { topic } : {}),
              ...(hold ? { hold } : {}),
            },
      );
      setView(next);
      if (!selected || action === "reset_demo" || (demo && action === "start_rehearsal")) setSelected(demo ? DEMO_DRAFT : next.items[0]?.draftId ?? "");
      setMessage("");
      setNote("");
      setEvRef("");
      setEvText("");
      setNotice(
        {
          start_rehearsal: demo ? "Your demo is ready: Haus 7 has sent a message about its bill. No PayPal or model call was made." : "Offline month created. No PayPal or model call was made.",
          reset_demo: "Demo reset to the start. No PayPal or model call was made.",
          message: "Message attached to this statement as an unverified claim.",
          prepare: next.items.find((i) => i.draftId === item?.draftId)?.work.proposal?.saved
            ? "Saved real AI agent proposal loaded: this case matches its recorded input. No model was called and nothing was sent."
            : "Offline checklist and reply template prepared. Nothing was sent.",
          review: "Review saved. The case is being investigated; payment status is unchanged.",
          evidence: "Evidence recorded as a manual entry. It is not a system check; prepare a fresh investigation.",
          hold: "Hold recorded. The case stays open.",
          explain: "Explanation recorded as sent. Waiting for the customer's reply; payment status is unchanged.",
          confirm: "Customer confirmation recorded. The dispute is closed; payment status is unchanged.",
          close: "Case closed. The existing payment record was not changed.",
        }[action],
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (snapshot) return;
    setBusy(true);
    setError("");
    try {
      setView(
        await request(demo ? "/api/coop/demo" : `/api/coop/workbench?period=${period}&source=${source}`),
      );
      setNotice("Reloaded saved records. This does not call PayPal.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decision(decision: "approve" | "reject") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/coop/decision", {
        period,
        source,
        draftId: item!.draftId,
        decision,
        by,
        reason: note,
      });
      setView(
        await request(`/api/coop/workbench?period=${period}&source=${source}`),
      );
      setNote("");
      setNotice(
        decision === "approve"
          ? "Approval saved. Execution remains a separate step; no payment was sent."
          : "Rejection saved. No payment was sent.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered =
    view?.items.filter(
      (i) =>
        filter === "all" ||
        (filter === "cases"
          ? hasOpenCase(i)
          : i.kind === filter),
    ) ?? [];
  const proposal = item?.work.proposal;
  const houses = view ? houseStatuses(view.items) : [];
  const mapHouses: MapHouse[] = view
    ? toMapHouses(houses)
    : group.map((p) => ({
        key: p.id,
        name: p.name,
        role: p.role,
        tone: "none",
        reason: "Not calculated yet",
        outlier: false,
      }));
  function select(draftId: string) {
    setSelected(draftId);
    setMessage("");
    setNote("");
    setError("");
    setNotice("");
  }
  return (
    <AppShell
      active={demo ? "demo" : "desk"}
      writable={!readOnly}
      envLabel={demo ? "Public demo" : undefined}
      eyebrow={`Community energy · ${month} · Group operator with AI agent`}
      title="Close the month"
      lead="Keep every decision clear: your group’s bills, producer payouts and open questions. One place to see what still needs you."
    >
      <div className={styles.desk}>
      {view && (
        <div className={styles.toolbar}>
          <span className={styles.source}>
            {demo ? "PUBLIC DEMO · YOUR OWN COPY · FICTIONAL DATA" : source === "agent"
              ? "SAVED AGENT RUN · PAYPAL SANDBOX"
              : source === "replay"
                ? "REPLAY · NEVER EXECUTED"
                : "OFFLINE REHEARSAL · NOT A MODEL RUN"}
          </span>
          {!demo && <Link href="/coop/demo">▶ Try the demo</Link>}
          <Link href={`/coop?period=${period}&source=rehearsal`}>
            Rehearsal
          </Link>
          <Link href="/coop?source=evidence">
            Archived sandbox evidence
          </Link>
          <button disabled={snapshot || busy} onClick={refresh}>
            ↻ Refresh records
          </button>
          {demo && (
            <button disabled={busy} onClick={() => act("reset_demo")}>
              Reset demo
            </button>
          )}
        </div>
      )}
      {demo && view && (
        <p className={styles.notice}>
          Your own offline copy of the June month. Follow Haus 7: read the bill check, add the fictional
          metering-operator reply, prepare and review the proposal, then record the outcome. No PayPal call, no
          live AI call. It is kept for 24 hours and cleared when the server restarts.
        </p>
      )}
      {snapshot && (
        <details className={styles.archive}>
          <summary>
            <strong>ARCHIVED SANDBOX EVIDENCE · READ ONLY</strong>
            <span className={styles.more}>Details</span>
          </summary>
          <p>
            Saved October 14, 2026. Transaction IDs and operator name are
            anonymized. No live PayPal lookup.{" "}
            <Link href="/coop/demo">Try the demo (no install)</Link> ·{" "}
            <Link href="/coop?source=rehearsal">
              Try the separate local rehearsal
            </Link>{" "}
            ·{" "}
            <Link href="/coop/exceptions?source=holdout">
              View the saved model evaluation
            </Link>
          </p>
        </details>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}{" "}
          <button onClick={refresh} disabled={snapshot || busy || !view}>
            Refresh saved records
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {!view ? (
        <div className={styles.intro}>
          <section className={styles.empty}>
            <p className={styles.eyebrow}>
              TRY A MONTH, WITHOUT CONNECTING ACCOUNTS
            </p>
            <h2>
              7 consumer bills. 3 producer payouts.
              <br />A clear place to start.
            </h2>
            <p>
              Use modelled June energy data to calculate real drafts locally.
              Add a fictional customer message, prepare an investigation and
              record your review.
            </p>
            <button
              className={styles.primary}
              disabled={busy || !writable}
              onClick={() => act("start_rehearsal")}
            >
              {busy ? "Preparing your month…" : demo ? "Start the demo →" : "Start offline June rehearsal →"}
            </button>
            <p className={styles.small}>
              No API key needed. No external payment, message or model call.
              This is an offline rehearsal, not an AI performance demonstration.
            </p>
            {!writable && (
              <p className={styles.warning}>
                Writing is disabled on this deployment. Use the local
                development app to rehearse.
              </p>
            )}
            <ol className={styles.introSteps}>
              <li>
                <b>01</b> Code calculates every bill and payout from integer Wh
                and cents.
              </li>
              <li>
                <b>02</b> Attach a fictional customer message to one statement;
                its house turns red on the map.
              </li>
              <li>
                <b>03</b> Prepare an offline investigation and record your
                review. Nothing is sent.
              </li>
            </ol>
          </section>
          {mapHouses.length > 0 && (
            <section className={styles.panel} aria-label="Group preview">
              <div className={styles.panelHead}>
                <h2>The modelled June group</h2>
                <span>Preview · nothing calculated yet</span>
              </div>
              <GridMap houses={mapHouses} />
              <p className={styles.small}>
                {group.filter((p) => p.role === "producer").length} producers
                with rooftop PV and{" "}
                {group.filter((p) => p.role === "consumer").length} consumers
                share one pool. Illustrative households, not real people. Status
                colours appear after the rehearsal month is calculated.
              </p>
            </section>
          )}
          <details className={styles.previewFold}>
          <summary>What the desk shows after the month is calculated</summary>
          <ul className={styles.preview}>
            <li>
              <strong>Monthly overview</strong>
              Consumer bills, producer payouts, reconciled payments and open
              customer cases, all computed in code.
            </li>
            <li>
              <strong>Grid area and per-household chart</strong>
              Each house coloured by its statement status. {OUTLIER_RULE}
            </li>
            <li>
              <strong>Statement, detail and AI guide</strong>
              Saved AI agent output only, plus a next-step checklist computed
              by code, not AI. You make every decision.
            </li>
          </ul>
          </details>
        </div>
      ) : (
        <>
          <section className={styles.metrics} aria-label="Monthly overview">
            <article>
              <p>CONSUMER BILLS</p>
              <strong>{eur(view.desk.totals.billedCents)}</strong>
              <span>
                {view.items.filter((i) => i.kind === "bill").length} statements
                · settlement total
              </span>
            </article>
            <article>
              <p>PRODUCER PAYOUTS</p>
              <strong>{eur(view.desk.totals.payoutCents)}</strong>
              <span>
                {view.items.filter((i) => i.kind === "payout").length}{" "}
                statements · settlement total
              </span>
            </article>
            <article className={styles.greenCard}>
              <p>RECONCILED PAYMENTS</p>
              <strong>
                {view.counts.matched}
                <small> / {view.items.length}</small>
              </strong>
              <span>Amount and reference matched</span>
            </article>
            <article className={styles.amberCard}>
              <p>OPEN CUSTOMER CASES</p>
              <strong>{view.counts.openCases}</strong>
              <span>{view.counts.review} drafts also need approval</span>
            </article>
          </section>
          <section className={styles.closeBar}>
            <div>
              <span
                className={
                  view.counts.readyToClose ? styles.greenDot : styles.amberDot
                }
              />
              <strong>
                {view.counts.readyToClose
                  ? "Payment records ready for month-end review"
                  : "This month is still open"}
              </strong>
            </div>
            <p>
              {view.counts.unmatched} payment records not reconciled ·{" "}
              {view.counts.openCases} customer cases unresolved
            </p>
            <span>Reviewing a claim never marks it paid.</span>
          </section>
          {view.closingNotes.map((p, i) => (
            <p className={styles.error} key={i}>
              {p}
            </p>
          ))}
          <section className={styles.visuals}>
            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>Grid area · Frankfurt am Main</h2>
              </div>
              <GridMap
                houses={mapHouses}
                selected={item?.draftId}
                onSelect={select}
              />
            </article>
            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>Per household</h2>
              </div>
              <HouseChart
                houses={houses}
                medians={groupMedians(view.items)}
                selected={item?.draftId}
                onSelect={select}
              />
            </article>
          </section>
          <section className={styles.workspace}>
            <aside className={styles.queue}>
              <div className={styles.queueHeading}>
                <h2>Your statements</h2>
                <span>{view.items.length}</span>
              </div>
              <div className={styles.filters} aria-label="Filter statements">
                {[
                  ["all", "All"],
                  ["bill", "Bills"],
                  ["payout", "Payouts"],
                  ["cases", "Cases"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ul>
                {filtered.map((row) => (
                  <li key={row.draftId}>
                    <button
                      className={
                        row.draftId === item?.draftId
                          ? styles.selectedRow
                          : styles.row
                      }
                      aria-pressed={row.draftId === item?.draftId}
                      onClick={() => select(row.draftId)}
                    >
                      <span className={styles.rowTop}>
                        <strong>{row.name}</strong>
                        <b>€{row.amountEur}</b>
                      </span>
                      <span className={styles.rowMeta}>
                        {row.kind === "bill"
                          ? "Consumer bill"
                          : "Producer payout"}{" "}
                        · {stateLabel(row)}
                      </span>
                      {row.work.messages.length > 0 && (
                        <span className={styles.caseBadge}>
                          {hasOpenCase(row) ? "Customer case open" : "Case closed"}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {!filtered.length && (
                <p className={styles.small}>No statements in this view.</p>
              )}
            </aside>
            {item && (
              <article className={styles.detail} key={item.draftId}>
                <div className={styles.detailHead}>
                  <div>
                    <p className={styles.eyebrow}>
                      {item.kind === "bill"
                        ? "CONSUMER BILL"
                        : "PRODUCER PAYOUT"}{" "}
                      · {item.name.toUpperCase()}
                    </p>
                    <h2>€{item.amountEur}</h2>
                    <p className={styles.statementId}>{item.statementId}</p>
                  </div>
                  <span className={styles.stateBadge}>{stateLabel(item)}</span>
                </div>
                <ol
                  className={styles.trace}
                  aria-label="Payment decision trail"
                >
                  <li>
                    <b>01</b>Calculated
                    <span>
                      {item.kWh} kWh · {item.priceCt} ct/kWh
                    </span>
                  </li>
                  <li>
                    <b>02</b>Human decision
                    <span>
                      {item.decision
                        ? `${item.status === "rejected" ? "Rejected" : "Approved"} · ${item.decision.by}`
                        : "Awaiting review"}
                    </span>
                  </li>
                  <li>
                    <b>03</b>Payment
                    <span>{paymentShort[item.payment.status]}</span>
                  </li>
                </ol>
                {item.chain && (
                  <section className={styles.section} id="stmt-check">
                    <div className={styles.sectionTitle}>
                      <h3>Bill check · meter → share → bill → payment</h3>
                      <span className={styles.codeBadge}>COMPUTED IN CODE</span>
                    </div>
                    {item.chain.allocation && item.chain.meter && (
                      <p>
                        Metered in total: <strong>{kwh(item.chain.meter.consumptionWh)} kWh</strong> = shared solar{" "}
                        <strong>{kwh(item.chain.allocation.receivedWh)} kWh</strong> (billed here) + residual{" "}
                        <strong>{kwh(item.chain.allocation.residualWh)} kWh</strong> from the household&apos;s own supplier
                        (not billed here).
                      </p>
                    )}
                    <ol className={styles.chain}>
                      {item.chain.links.map((l) => (
                        <li key={l.step} className={styles[`link_${l.status}`]}>
                          <strong>
                            {l.step} · {linkLabel[l.status]}
                          </strong>
                          <p>{l.text}</p>
                        </li>
                      ))}
                    </ol>
                    <p className={styles.small}>
                      Recorded values are read from the ledger and never replaced by the recomputation. Total consumption
                      above the shared energy is normal.
                    </p>
                  </section>
                )}
                <details className={styles.section} id="stmt-settlement">
                  <summary className={styles.sectionTitle}>
                    <h3>The settlement</h3>
                    <span className={styles.codeBadge}>
                      AMOUNT COMPUTED IN CODE
                    </span>
                  </summary>
                  <p>{item.summary}</p>
                  <p className={styles.small}>
                    {source === "rehearsal"
                      ? "Scripted rehearsal note · not AI."
                      : item.summarySource === "agent"
                        ? "AI note · numbers checked; meaning still needs review."
                        : "Summary prepared by code."}{" "}
                    Energy shown rounded; the calculation uses integer Wh and
                    cents.
                  </p>
                  {item.flags.map((f) => (
                    <p className={styles.warning} key={f.code}>
                      {f.message}
                    </p>
                  ))}
                  {item.decision && (
                    <p className={styles.small}>
                      {item.decision.by} · {date(item.decision.at)}
                      {item.decision.reason && ` · ${item.decision.reason}`}
                    </p>
                  )}
                </details>
                <details className={styles.section} id="stmt-evidence">
                  <summary className={styles.sectionTitle}>
                    <h3>Payment evidence</h3>
                    <span className={styles.codeBadge}>SAVED RECORDS</span>
                  </summary>
                  <div className={styles.factGrid}>
                    <div>
                      <label>Payment status</label>
                      <strong>{paymentShort[item.payment.status]}</strong>
                      <p>{item.payment.label}</p>
                      {item.payment.observed && (
                        <small>
                          Checked PayPal field: {item.payment.observed.field} = {item.payment.observed.value}
                          {item.payment.observed.amount && ` · paid amount ${item.payment.observed.amount} €`}
                          {item.payment.observed.reference && ` · reference ${item.payment.observed.reference}`}
                          {" "}· saved observation, not a live call.{" "}
                        </small>
                      )}
                      {item.reconciliation && (
                        <small>
                          Checked {date(item.reconciliation.checkedAt)}
                        </small>
                      )}
                    </div>
                    <div>
                      <label>Bank account</label>
                      <strong>Not connected</strong>
                      <p>
                        A bank transfer claim needs a person to check the bank
                        record.
                      </p>
                    </div>
                  </div>
                  {item.externalId && (
                    <p className={styles.statementId}>
                      Provider reference: {item.externalId}
                    </p>
                  )}
                </details>
                <section className={styles.section} id="stmt-messages">
                  <div className={styles.sectionTitle}>
                    <h3>Customer messages</h3>
                    <span className={styles.claimBadge}>UNVERIFIED CLAIMS</span>
                  </div>
                  {item.work.topic && (
                    <p className={styles.small}>Dispute: {topicLabel[item.work.topic]}</p>
                  )}
                  {item.work.messages.length ? (
                    item.work.messages.map((m) => (
                      <blockquote className={styles.message} key={m.id}>
                        <span>
                          {m.id} · attached by {m.by} · {date(m.at)}
                        </span>
                        <p>{m.text}</p>
                      </blockquote>
                    ))
                  ) : (
                    <p className={styles.small}>
                      Attach the message to this exact statement. It stays
                      separate from payment facts.
                    </p>
                  )}
                  <label className={styles.field}>
                    Your name
                    <input
                      value={by}
                      maxLength={60}
                      placeholder="Operator name for the review record"
                      onChange={(e) => setBy(e.target.value)}
                      autoComplete="name"
                      disabled={readOnly || demo}
                    />
                  </label>
                  <label className={styles.field}>
                    Message received
                    <textarea
                      value={message}
                      maxLength={2000}
                      placeholder="Paste the customer’s message here…"
                      onChange={(e) => setMessage(e.target.value)}
                      disabled={readOnly}
                    />
                  </label>
                  {!item.work.messages.length && (
                    <label className={styles.field}>
                      What does the customer dispute?
                      <select
                        value={topic}
                        onChange={(e) => setTopic(e.target.value as DisputeTopic)}
                        disabled={readOnly}
                      >
                        {(item.kind === "bill" ? (["meter", "amount", "already_paid"] as const) : (["already_paid"] as const)).map((t) => (
                          <option key={t} value={t}>
                            {topicLabel[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {source === "rehearsal" && (
                    <div className={styles.actions}>
                      {item.chain?.meter && (
                        <button
                          className={styles.textButton}
                          disabled={busy || readOnly}
                          onClick={() => {
                            setTopic("meter");
                            setMessage(
                              `My meter shows about ${Math.round(item.chain!.meter!.consumptionWh / 1000)} kWh for ${period}, but your bill says ${item.kWh} kWh. Which one is right? Reference ${item.statementId}.`,
                            );
                          }}
                        >
                          Use a fictional meter question
                        </button>
                      )}
                      <button
                        className={styles.textButton}
                        disabled={busy || readOnly}
                        onClick={() => {
                          setTopic("already_paid");
                          setMessage(
                            `I paid last week by bank transfer under my partner’s name. The transfer includes last month too. Reference ${item.statementId}.`,
                          );
                        }}
                      >
                        Use a fictional payment-claim example
                      </button>
                    </div>
                  )}
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      disabled={!canWrite || !message.trim()}
                      onClick={() => act("message")}
                    >
                      Attach unverified message
                    </button>
                    <button
                      className={styles.primary}
                      disabled={!canWrite || !item.work.messages.length || item.work.status.startsWith("closed")}
                      onClick={() => act("prepare")}
                    >
                      Prepare offline investigation
                    </button>
                  </div>
                </section>
                {proposal && (
                  <section
                    className={`${styles.section} ${styles.investigation}`}
                    id="stmt-investigation"
                  >
                    <div className={styles.sectionTitle}>
                      <h3>Investigation ready for review</h3>
                      <span className={styles.source}>
                        {proposal.saved
                          ? "SAVED REAL AI PROPOSAL · ONE RECORDED RUN"
                          : proposal.source === "agent"
                            ? "AI PROPOSAL"
                            : "CODE TEMPLATE · NOT AI"}
                      </span>
                    </div>
                    {item.proposalStale && (
                      <p className={styles.warning}>
                        The statement or messages changed. Prepare a fresh
                        investigation before reviewing.
                      </p>
                    )}
                    <details className={styles.fold}>
                    <summary>Investigation details · reply draft</summary>
                    <p>{proposal.reason}</p>
                    <div className={styles.evidenceTags}>
                      {proposal.evidence.map((id) => {
                        const evidence = item.evidence.find((e) => e.id === id);
                        return (
                          <details key={id}>
                            <summary>
                              {id} ·{" "}
                              {evidence?.kind === "claim" ? "Claim" : evidence?.kind === "manual" ? "Manual entry" : "Fact"}
                            </summary>
                            <p>
                              {evidence?.text ?? "Evidence no longer available"}
                            </p>
                          </details>
                        );
                      })}
                    </div>
                    <h4>What still needs checking</h4>
                    <ul>
                      {proposal.unverified.map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                    </ul>
                    <h4>Prepared checklist</h4>
                    <ol>
                      {proposal.checks.map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                    </ol>
                    <div className={styles.reply}>
                      <span>REPLY DRAFT · NOT SENT</span>
                      <p>{proposal.replyDraft}</p>
                    </div>
                    <p className={styles.small}>
                      {proposal.saved
                        ? `${proposal.model} · recorded ${date(proposal.saved.ranAt)} on exactly this input (message N1 and the fictional metering-operator reply E1). Loaded, not generated now. Evidence IDs were checked by code; numbers and meaning were checked by a person for this one run. One fictional case, not an accuracy measure.`
                        : proposal.source === "agent"
                          ? `${proposal.model} · Evidence IDs were checked. This does not guarantee the explanation is correct.`
                          : item.draftId === DEMO_DRAFT && period === "2026-06"
                            ? "A fixed checklist and reply template. No language model was called. The saved real AI proposal is used only when this case matches its recorded input: message N1 plus the fictional metering-operator reply."
                            : "A fixed checklist and reply template. No language model was called."}
                    </p>
                    </details>
                    <label className={styles.field}>
                      Your note for this step
                      <textarea
                        value={note}
                        maxLength={2000}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="What will you check, what did you send, or what did the customer confirm?"
                        disabled={readOnly}
                      />
                    </label>
                    <div className={styles.actions}>
                      {item.work.status === "open" && (
                        <button
                          className={styles.primary}
                          disabled={!canWrite || item.proposalStale || !note.trim()}
                          onClick={() => act("review")}
                        >
                          Record review · start checks
                        </button>
                      )}
                      {item.work.topic !== "already_paid" &&
                        (item.work.status === "investigating" || item.work.status === "waiting_external") && (
                          <button
                            className={styles.primary}
                            disabled={!canWrite || item.proposalStale || item.chain?.billStatus !== "match" || !note.trim()}
                            title={item.chain?.billStatus !== "match" ? "The bill check does not confirm this bill" : undefined}
                            onClick={() => act("explain")}
                          >
                            Record explanation sent
                          </button>
                        )}
                      {item.work.status === "explained_awaiting_reply" && (
                        <>
                          <button className={styles.primary} disabled={!canWrite || !note.trim()} onClick={() => act("confirm")}>
                            Record customer confirmation
                          </button>
                          <button className={styles.secondary} disabled={!canWrite || !note.trim()} onClick={() => act("close")}>
                            Close without customer confirmation
                          </button>
                        </>
                      )}
                      {item.work.topic === "already_paid" &&
                        (item.work.status === "investigating" || item.work.status === "waiting_external") && (
                          <button
                            className={styles.primary}
                            disabled={!canWrite || item.proposalStale || item.payment.status !== "paid" || !note.trim()}
                            onClick={() => act("close")}
                          >
                            Close · payment reconciled
                          </button>
                        )}
                      {(["investigating", "waiting_external", "correction_needed", "explained_awaiting_reply"] as CaseStatus[]).includes(item.work.status) && (
                        <>
                          <button className={styles.secondary} disabled={!canWrite || !note.trim()} onClick={() => act("hold", "external")}>
                            Wait for external answer
                          </button>
                          <button className={styles.secondary} disabled={!canWrite || !note.trim()} onClick={() => act("hold", "correction")}>
                            Correction needed
                          </button>
                        </>
                      )}
                    </div>
                    <p className={styles.small}>
                      Dispute:{" "}
                      {item.proposalStale ? "Needs a fresh investigation" : caseLabel[item.work.status]} · Payment:{" "}
                      {paymentShort[item.payment.status]}. These are separate: a closed dispute does not mean the bill
                      is paid. Recording a step does not send a reply or change any payment.
                    </p>
                  </section>
                )}
                {item.work.messages.length > 0 && (
                  <section className={styles.section} id="stmt-manual">
                    <div className={styles.sectionTitle}>
                      <h3>Evidence received</h3>
                      <span className={styles.claimBadge}>MANUAL · NOT VERIFIED BY THE SYSTEM</span>
                    </div>
                    {(item.work.evidence ?? []).map((e) => (
                      <blockquote className={styles.message} key={e.id}>
                        <span>
                          {e.id} · {EVIDENCE_SOURCES[e.source]}
                          {e.reference && ` · ref ${e.reference}`} · entered by {e.by} · {date(e.at)}
                        </span>
                        <p>{e.text}</p>
                      </blockquote>
                    ))}
                    <p className={styles.small}>
                      Record what a metering operator, grid operator or customer sent you. A hand-entered PayPal
                      transaction id does not count as a payment check; only the saved PayPal reconciliation does.
                    </p>
                    <div className={styles.evidenceForm}>
                      <label className={styles.field}>
                        From
                        <select value={evOrigin} onChange={(e) => setEvOrigin(e.target.value as EvidenceSource)} disabled={readOnly}>
                          {(Object.keys(EVIDENCE_SOURCES) as EvidenceSource[]).map((k) => (
                            <option key={k} value={k}>
                              {EVIDENCE_SOURCES[k]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.field}>
                        Reference (optional)
                        <input value={evRef} maxLength={80} onChange={(e) => setEvRef(e.target.value)} disabled={readOnly} />
                      </label>
                    </div>
                    <label className={styles.field}>
                      What it says
                      <textarea
                        value={evText}
                        maxLength={2000}
                        placeholder="Summarise the evidence. Do not paste personal data you do not need."
                        onChange={(e) => setEvText(e.target.value)}
                        disabled={readOnly}
                      />
                    </label>
                    {source === "rehearsal" && item.chain?.meter && (
                      <button
                        className={styles.textButton}
                        disabled={busy || readOnly}
                        onClick={() => {
                          setEvOrigin("metering_operator");
                          setEvRef("");
                          setEvText(
                            `Fictional reply: the metering operator confirms ${(item.chain!.meter!.consumptionWh / 1000).toFixed(1)} kWh for ${period}, matching the meter file.`,
                          );
                        }}
                      >
                        Use a fictional metering-operator reply
                      </button>
                    )}
                    <div className={styles.actions}>
                      <button
                        className={styles.secondary}
                        disabled={!canWrite || !evText.trim() || item.work.status.startsWith("closed")}
                        onClick={() => act("evidence")}
                      >
                        Add manual evidence
                      </button>
                    </div>
                  </section>
                )}
                {!demo && item.status === "pending_approval" && (
                  <section className={styles.section}>
                    <h3>Your payment decision</h3>
                    <p>
                      Approve this exact{" "}
                      {item.kind === "bill" ? "bill" : "payout"} for{" "}
                      <strong>€{item.amountEur}</strong>. Execution is a
                      separate step.
                    </p>
                    {hasOpenCase(item) && (
                        <p className={styles.warning}>
                          This statement has an unresolved customer case. Review
                          it before deciding.
                        </p>
                      )}
                    <label className={styles.field}>
                      Rejection reason, if needed
                      <input
                        value={note}
                        maxLength={300}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={readOnly}
                      />
                    </label>
                    <div className={styles.actions}>
                      <button
                        className={styles.primary}
                        disabled={!canWrite}
                        onClick={() => decision("approve")}
                      >
                        Approve €{item.amountEur}
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={!canWrite || !note.trim()}
                        onClick={() => decision("reject")}
                      >
                        Reject with reason
                      </button>
                    </div>
                    <p className={styles.small}>
                      Limits: €500 per payment · €5,000 per day. Your name is a
                      local audit label, not authentication.
                    </p>
                  </section>
                )}
                {!!item.work.history.length && (
                  <details className={styles.history} id="stmt-history" open>
                    <summary>
                      Case timeline · {item.work.history.length} events · now: {caseLabel[item.work.status]}
                    </summary>
                    <p className={styles.small}>
                      Day numbers are calendar time since the first event, not working time. Waiting for others and
                      working on the case are not measured separately here.
                    </p>
                    <ol>
                      {item.work.history.map((event, i) => (
                        <li key={i}>
                          <strong>
                            Day {Math.floor((Date.parse(event.at) - Date.parse(item.work.history[0].at)) / DAY_MS)} ·{" "}
                            {event.event.replaceAll("_", " ")} · {event.by}
                          </strong>
                          <span>{date(event.at)}</span>
                          <p>{event.detail}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </article>
            )}
            {item && (
              <AiGuide item={item} source={source} model={view.desk.model} />
            )}
          </section>
          <details className={styles.footer}>
            <summary>Notes on data and records</summary>
            <p>
              Modelled energy data · integer Wh and cents · operator share{" "}
              {eur(view.desk.totals.operatorCents)} before PayPal fees and
              operating costs.
            </p>
            <p>
              Saved {date(view.desk.savedAt)}. Refresh reads local records;
              payment execution and provider checks use the existing separate
              CLI workflow. {!writable && "This deployment is read-only."}
            </p>
          </details>
        </>
      )}
      </div>
    </AppShell>
  );
}
