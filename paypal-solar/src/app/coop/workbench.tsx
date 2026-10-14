"use client";
import { useState } from "react";
import Link from "next/link";
import type { WorkbenchView, WorkItem } from "@/lib/coop/workbench-types";
import styles from "./workbench.module.css";

const eur = (cents: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
const date = (value: string) =>
  new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const stateLabel = (item: WorkItem) =>
  item.reconciliation?.status === "matched"
    ? "Reconciled"
    : {
        draft: "Draft",
        pending_approval: "Needs approval",
        approved: "Approved · not sent",
        rejected: "Rejected",
        executing: "Execution in progress",
        executed: "Sent · check payment",
        failed: "Check execution outcome",
      }[item.status];

export default function Workbench({
  initial,
  writable = true,
  snapshot = false,
}: {
  initial: WorkbenchView | null;
  writable?: boolean;
  snapshot?: boolean;
}) {
  const [view, setView] = useState(initial);
  const [selected, setSelected] = useState(
    initial?.items.find((i) => i.work.messages.length)?.draftId ??
      initial?.items[0]?.draftId ??
      "",
  );
  const [filter, setFilter] = useState("all");
  const [by, setBy] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const item =
    view?.items.find((i) => i.draftId === selected) ?? view?.items[0];
  const canWrite = !snapshot && writable && !!by.trim() && !busy;
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
  async function act(
    action: "start_rehearsal" | "message" | "prepare" | "review" | "resolve",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await request(
        "/api/coop/workbench",
        action === "start_rehearsal"
          ? { action }
          : {
              action,
              period,
              source,
              draftId: item!.draftId,
              version: item!.version,
              by,
              text: action === "message" ? message : note,
            },
      );
      setView(next);
      if (!selected) setSelected(next.items[0]?.draftId ?? "");
      setMessage("");
      setNote("");
      setNotice(
        action === "review"
          ? "Review saved. The case is awaiting evidence; payment status is unchanged."
          : action === "prepare"
            ? "Offline checklist and reply template prepared. Nothing was sent."
            : action === "message"
              ? "Message attached to this statement as an unverified claim."
              : action === "resolve"
                ? "Case resolution recorded. The existing payment record was not changed."
                : "Offline month created. No PayPal or model call was made.",
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
        await request(`/api/coop/workbench?period=${period}&source=${source}`),
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
          ? i.work.messages.length &&
            (i.work.status !== "resolved" ||
              i.proposalStale ||
              i.reconciliation?.status !== "matched")
          : i.kind === filter),
    ) ?? [];
  const proposal = item?.work.proposal;
  return (
    <main className={styles.shell}>
      <nav className={styles.nav} aria-label="Main navigation">
        <Link className={styles.brand} href="/coop">
          <span className={styles.logo}>S</span> Solar Co-op
          <span className={styles.brandSub}>OPERATOR DESK</span>
        </Link>
        <div>
          <Link href="/energy">Energy overview</Link>
          <Link href="/coop/exceptions">Evaluation lab</Link>
          <span className={styles.environment}>LOCAL PROTOTYPE</span>
        </div>
      </nav>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            COMMUNITY ENERGY · {month.toUpperCase()}
          </p>
          <h1>
            Close the month.
            <br />
            <span>Keep every decision clear.</span>
          </h1>
          <p className={styles.lead}>
            Your group’s bills, producer payouts and open questions. One place
            to see what still needs you.
          </p>
        </div>
        <aside className={styles.operator}>
          <span className={styles.orbit}>✦</span>
          <strong>
            Group operator
            <br />
            with AI agent
          </strong>
          <p>
            Code calculates. AI proposes.
            <br />
            You review. PayPal processes.
          </p>
        </aside>
      </header>
      {snapshot && (
        <p className={styles.notice}>
          ARCHIVED SANDBOX EVIDENCE · READ ONLY · Saved October 14, 2026.
          Transaction IDs and operator name are anonymized. No live PayPal
          lookup.{" "}
          <Link href="/coop?source=rehearsal">
            Try the separate local rehearsal
          </Link>{" "}
          ·{" "}
          <Link href="/coop/exceptions?source=holdout">
            View the saved model evaluation
          </Link>
        </p>
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
        <section className={styles.empty}>
          <p className={styles.eyebrow}>
            TRY A MONTH, WITHOUT CONNECTING ACCOUNTS
          </p>
          <h2>
            7 consumer bills. 3 producer payouts.
            <br />A clear place to start.
          </h2>
          <p>
            Use modelled June energy data to calculate real drafts locally. Add
            a fictional customer message, prepare an investigation and record
            your review.
          </p>
          <button
            className={styles.primary}
            disabled={busy || !writable}
            onClick={() => act("start_rehearsal")}
          >
            {busy ? "Preparing your month…" : "Start offline June rehearsal →"}
          </button>
          <p className={styles.small}>
            No API key needed. No external payment, message or model call. This
            is an offline rehearsal, not an AI performance demonstration.
          </p>
          {!writable && (
            <p>
              Writing is disabled on this deployment. Use the local development
              app to rehearse.
            </p>
          )}
        </section>
      ) : (
        <>
          <section className={styles.toolbar}>
            <span className={styles.source}>
              {source === "agent"
                ? "SAVED AGENT RUN · PAYPAL SANDBOX"
                : source === "replay"
                  ? "REPLAY · NEVER EXECUTED"
                  : "OFFLINE REHEARSAL · NOT A MODEL RUN"}
            </span>
            <div>
              <Link href={`/coop?period=${period}&source=rehearsal`}>
                Rehearsal
              </Link>
              <Link href="/coop?source=evidence">
                Archived sandbox evidence
              </Link>
              <button disabled={snapshot || busy} onClick={refresh}>
                ↻ Refresh records
              </button>
            </div>
          </section>
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
                      onClick={() => {
                        setSelected(row.draftId);
                        setMessage("");
                        setNote("");
                        setError("");
                        setNotice("");
                      }}
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
                          {row.work.status === "resolved" &&
                          !row.proposalStale &&
                          row.reconciliation?.status === "matched"
                            ? "Case resolved"
                            : "Customer case attached"}
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
                    <b>03</b>Provider record
                    <span>
                      {item.reconciliation?.externalStatus ??
                        (item.externalId ? "Result saved" : "Not sent")}
                    </span>
                  </li>
                </ol>
                <section className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <h3>The settlement</h3>
                    <span className={styles.codeBadge}>
                      AMOUNT COMPUTED IN CODE
                    </span>
                  </div>
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
                </section>
                <section className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <h3>Payment evidence</h3>
                    <span className={styles.codeBadge}>SAVED RECORDS</span>
                  </div>
                  <div className={styles.factGrid}>
                    <div>
                      <label>Provider status</label>
                      <strong>
                        {item.reconciliation?.externalStatus ??
                          "No check recorded"}
                      </strong>
                      <p>
                        {item.reconciliation?.reason ??
                          "Sending or approving is not proof of payment."}
                      </p>
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
                </section>
                <section className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <h3>Customer messages</h3>
                    <span className={styles.claimBadge}>UNVERIFIED CLAIMS</span>
                  </div>
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
                    />
                  </label>
                  <label className={styles.field}>
                    Message received
                    <textarea
                      value={message}
                      maxLength={2000}
                      placeholder="Paste the customer’s message here…"
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </label>
                  {source === "rehearsal" && (
                    <button
                      className={styles.textButton}
                      disabled={busy}
                      onClick={() =>
                        setMessage(
                          `I paid last week by bank transfer under my partner’s name. The transfer includes last month too. Reference ${item.statementId}.`,
                        )
                      }
                    >
                      Use a fictional payment-claim example
                    </button>
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
                      disabled={!canWrite || !item.work.messages.length}
                      onClick={() => act("prepare")}
                    >
                      Prepare offline investigation
                    </button>
                  </div>
                </section>
                {proposal && (
                  <section
                    className={`${styles.section} ${styles.investigation}`}
                  >
                    <div className={styles.sectionTitle}>
                      <h3>Investigation ready for review</h3>
                      <span className={styles.source}>
                        {proposal.source === "agent"
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
                    <p>{proposal.reason}</p>
                    <div className={styles.evidenceTags}>
                      {proposal.evidence.map((id) => {
                        const evidence = item.evidence.find((e) => e.id === id);
                        return (
                          <details key={id}>
                            <summary>
                              {id} ·{" "}
                              {evidence?.kind === "claim" ? "Claim" : "Fact"}
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
                      {proposal.source === "agent"
                        ? `${proposal.model} · Evidence IDs were checked. This does not guarantee the explanation is correct.`
                        : "A fixed checklist and reply template. No language model was called."}
                    </p>
                    <label className={styles.field}>
                      Your next step / resolution note
                      <textarea
                        value={note}
                        maxLength={2000}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="What will you verify, or what evidence resolved the case?"
                      />
                    </label>
                    <div className={styles.actions}>
                      <button
                        className={styles.primary}
                        disabled={
                          !canWrite ||
                          item.proposalStale ||
                          item.work.status !== "open" ||
                          !note.trim()
                        }
                        onClick={() => act("review")}
                      >
                        Record review · await evidence
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={
                          !canWrite ||
                          item.proposalStale ||
                          item.work.status !== "awaiting_evidence" ||
                          item.status !== "executed" ||
                          item.reconciliation?.status !== "matched" ||
                          !note.trim()
                        }
                        onClick={() => act("resolve")}
                      >
                        Resolve reconciled case
                      </button>
                    </div>
                    <p className={styles.small}>
                      Case:{" "}
                      {item.proposalStale
                        ? "Needs a fresh investigation"
                        : item.work.status.replaceAll("_", " ")}
                      . Review records a task; it does not send a reply, change
                      reminders, or update payment status.
                    </p>
                  </section>
                )}
                {item.status === "pending_approval" && (
                  <section className={styles.section}>
                    <h3>Your payment decision</h3>
                    <p>
                      Approve this exact{" "}
                      {item.kind === "bill" ? "bill" : "payout"} for{" "}
                      <strong>€{item.amountEur}</strong>. Execution is a
                      separate step.
                    </p>
                    {item.work.messages.length > 0 &&
                      item.work.status !== "resolved" && (
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
                  <details className={styles.history}>
                    <summary>
                      Case activity · {item.work.history.length} events
                    </summary>
                    <ol>
                      {item.work.history.map((event, i) => (
                        <li key={i}>
                          <strong>
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
          </section>
          <footer className={styles.footer}>
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
          </footer>
        </>
      )}
    </main>
  );
}
