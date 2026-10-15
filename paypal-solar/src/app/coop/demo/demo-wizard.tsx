"use client";
import { useState } from "react";
import Link from "next/link";
import type { WorkbenchView, WorkItem } from "../../../lib/coop/workbench-types";
import styles from "./demo-wizard.module.css";

// Same value as src/lib/coop/demo.ts (not imported: that module uses the file system).
const DEMO_DRAFT = "bill-ST-202606-H07";
/** Screens 2–9 are the eight steps; 1 is the start and 10 the end. */
const TOTAL = 8;
const LAST = TOTAL + 2;
const kwh = (wh: number) => (wh / 1000).toFixed(1);
const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/** One archived PayPal sandbox observation, as shown on the demo's PayPal screen. */
export interface ArchiveRow { name: string; kind: "bill" | "payout"; amountEur: string; externalStatus: string; matched: boolean }

/**
 * The first screen not done yet. Screens 2–4 only need reading (`readUpTo` = last one passed);
 * the rest follow the Haus 7 case state.
 */
export function firstOpenScreen(item: WorkItem | undefined, readUpTo: number): number {
  if (!item) return 1;
  const w = item.work;
  if (w.status.startsWith("closed")) return LAST;
  if (!w.evidence?.length) return Math.min(Math.max(readUpTo + 1, 2), 5);
  if (!w.proposal || item.proposalStale) return 6;
  if (w.status === "open") return 7;
  if (w.status === "explained_awaiting_reply") return 9;
  return 8;
}

export function evidenceText(item: WorkItem, period: string) {
  return `Fictional reply: the metering operator confirms ${kwh(item.chain?.meter?.consumptionWh ?? 0)} kWh for ${period}, matching the meter file.`;
}

export function suggestedNote(item: WorkItem, screen: number) {
  const a = item.chain?.allocation;
  if (screen === 7) return "Checked the split against the bill check and the metering operator's reply.";
  if (screen === 8)
    return a
      ? `Sent the explanation: ${kwh(a.receivedWh)} kWh shared solar on this bill, ${kwh(a.residualWh)} kWh from the household's own supplier.`
      : "Sent the explanation of the bill.";
  return "Customer replied: understood, no further questions.";
}

export default function DemoWizard({ initial, archive = [] }: { initial: WorkbenchView | null; archive?: ArchiveRow[] }) {
  const [view, setView] = useState(initial);
  const item = view?.items.find((i) => i.draftId === DEMO_DRAFT);
  const [readUpTo, setReadUpTo] = useState(1);
  const [screen, setScreen] = useState(() => firstOpenScreen(item, 1));
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = firstOpenScreen(item, readUpTo);
  const period = view?.desk.period ?? "2026-06";

  async function post(body: object) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/coop/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "The request could not be completed");
      setView(data as WorkbenchView);
      return data as WorkbenchView;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const act = (action: string, extra: object = {}) => post({ action, version: item!.version, ...extra });
  async function startOver(first: boolean) {
    if (await post({ action: first ? "start" : "reset" })) {
      setReadUpTo(1);
      setNote(null);
      setScreen(2);
    }
  }
  const next = () => {
    if (screen <= 4) setReadUpTo(Math.max(readUpTo, screen));
    setNote(null);
    setScreen(screen + 1);
  };
  const done = screen < open;

  const c = item?.chain;
  const p = item?.work.proposal;
  const bills = view?.items.filter((i) => i.kind === "bill") ?? [];
  const payouts = view?.items.filter((i) => i.kind === "payout") ?? [];
  let title = "";
  let tag = "";
  let body: React.ReactNode = null;
  let action: React.ReactNode = null;
  let learn = "";
  if (screen === 1 || !item) {
    title = "One month of community energy settlement";
    body = (
      <>
        <p className={styles.lead}>Collect bills, pay producers, and reconcile community energy payments with PayPal.</p>
        <p>
          Solar Co-op helps energy-sharing operators manage monthly settlement. Code calculates amounts, AI prepares
          drafts and proposes checks for disputes, and people approve payment actions.
        </p>
        <p>
          You are the operator of a ten-household group. You see this month&apos;s bills and payouts, what PayPal collected
          and paid in our saved sandbox run, and how one customer dispute is handled.
        </p>
        <p className={styles.small}>Your own offline copy. Fictional data. No PayPal call, no live AI call, nothing is sent.</p>
      </>
    );
    action = (
      <button className={styles.primary} disabled={busy} onClick={() => startOver(true)}>
        {busy ? "Preparing your copy… this can take a few seconds" : "Start the demo →"}
      </button>
    );
  } else if (screen === 2) {
    title = "This month: who pays, who gets paid";
    body = (
      <>
        <div className={styles.split2}>
          <div><small>CONSUMER BILLS → PAYPAL INVOICES</small><b>{bills.length} bills · {eur(view!.desk.totals.billedCents)}</b></div>
          <div><small>PRODUCER PAYOUTS → PAYPAL PAYOUTS</small><b>{payouts.length} payouts · {eur(view!.desk.totals.payoutCents)}</b></div>
        </div>
        <details className={styles.more}>
          <summary>All {bills.length + payouts.length} drafts</summary>
          <ol>{[...bills, ...payouts].map((i) => <li key={i.draftId}>{i.name} · {i.kind === "bill" ? "bill" : "payout"} · {i.kWh} kWh · €{i.amountEur}</li>)}</ol>
        </details>
        <p>
          Calculated in code from the June quarter-hour meter data and the allocation rule. Every draft waits for a
          person&apos;s approval. In our recorded run, an AI agent prepared these ten drafts through tools; it had no
          approval or execution tool.
        </p>
      </>
    );
    learn = "Code calculates every amount. A person approves each payment action before anything is sent.";
  } else if (screen === 3) {
    const paid = archive.filter((r) => r.kind === "bill" && r.externalStatus === "PAID").length;
    const paidOut = archive.filter((r) => r.kind === "payout" && r.externalStatus === "SUCCESS").length;
    const matched = archive.filter((r) => r.matched).length;
    const nBills = archive.filter((r) => r.kind === "bill").length;
    const nPayouts = archive.length - nBills;
    title = "PayPal collects and pays out";
    tag = "SAVED PAYPAL SANDBOX RUN · ARCHIVED RECORDS · NO NEW PAYPAL CALL";
    body = (
      <>
        <div className={styles.split2}>
          <div>
            <small>CONSUMERS PAY THE INVOICE</small>
            <b>{paid} of {nBills} PAID</b>
            <p className={styles.small}>PayPal e-mails the invoice. Consumers pay with a PayPal account or by debit or credit card.</p>
          </div>
          <div>
            <small>PRODUCERS RECEIVE A PAYOUT</small>
            <b>{paidOut} of {nPayouts} SUCCESS</b>
            <p className={styles.small}>Sent to their e-mail. They need a PayPal account to claim it; unclaimed payouts return after 30 days.</p>
          </div>
        </div>
        <p className={styles.check}>✓ {matched} of {archive.length} matched to the drafts by amount, statement reference and status.</p>
        <p className={styles.small}>
          Collection and payouts are separate actions a person approves. Payouts do not wait for invoices, and collected
          money is not distributed automatically.
        </p>
      </>
    );
    learn = "PayPal moves the money in both directions; the desk checks every result against its own drafts.";
  } else if (screen === 4) {
    title = "When something goes wrong: Haus 7 doubts its bill";
    tag = "A SEPARATE FICTIONAL CASE · OFFLINE REHEARSAL · NOT ONE OF THE ARCHIVED PAYMENTS";
    body = (
      <>
        <blockquote className={styles.quote}>“{item.work.messages[0]?.text}”</blockquote>
        {c?.meter && c.allocation && (
          <div className={styles.split}>
            <div><small>METERED IN JUNE</small><b>{kwh(c.meter.consumptionWh)} kWh</b></div>
            <span>=</span>
            <div className={styles.billed}><small>SHARED SOLAR · ON THIS BILL</small><b>{kwh(c.allocation.receivedWh)} kWh</b><em>€{item.amountEur}</em></div>
            <span>+</span>
            <div><small>OWN SUPPLIER · NOT ON THIS BILL</small><b>{kwh(c.allocation.residualWh)} kWh</b></div>
          </div>
        )}
        <p className={styles.check}>✓ Meter, allocation and bill match. Computed in code.</p>
      </>
    );
    learn = "The meter total is not the billed energy. Only the shared solar part is on this bill.";
  } else if (screen === 5) {
    const ev = item.work.evidence?.[0];
    title = "Ask the metering operator";
    body = (
      <div className={styles.card}>
        <small>{ev ? "EVIDENCE · MANUAL · NOT VERIFIED BY THE SYSTEM" : "THE METERING OPERATOR REPLIES (FICTIONAL)"}</small>
        <p>{ev ? ev.text : evidenceText(item, period)}</p>
      </div>
    );
    learn = "Evidence typed in by hand is labelled manual. It never counts as a system check.";
    action = done ? null : (
      <button className={styles.primary} disabled={busy} onClick={() => act("evidence", { origin: "metering_operator", text: evidenceText(item, period) })}>
        Add this reply as evidence
      </button>
    );
  } else if (screen === 6) {
    title = "Review the recorded AI proposal";
    body = done && p ? (
      <>
        <p className={styles.tag}>{p.saved ? "SAVED REAL AI PROPOSAL · ONE RECORDED RUN" : "CODE TEMPLATE · NOT AI"}</p>
        <div className={styles.card}>
          <small>REPLY DRAFT · NOT SENT</small>
          <p className={styles.reply}>{p.replyDraft}</p>
        </div>
        <details className={styles.more}>
          <summary>Checks it proposes ({p.checks.length}) and evidence it cites ({p.evidence.length})</summary>
          <ol>{p.checks.map((t, i) => <li key={i}>{t}</li>)}</ol>
          <p className={styles.small}>Cites: {p.evidence.join(", ")}</p>
        </details>
        <p className={styles.small}>
          {p.saved
            ? `${p.model}, recorded once on exactly this input and loaded now. No model is called. One fictional case, not an accuracy measure.`
            : "Shown because this case differs from the recorded input."}
        </p>
      </>
    ) : (
      <p>
        In the recorded run, the agent read the statement, the bill check, the customer message and the manual evidence.
        Load its saved checks and reply draft for this same input. No model will be called.
      </p>
    );
    learn = "The AI drafts. Nothing is sent, and a person decides next.";
    action = done ? null : (
      <button className={styles.primary} disabled={busy} onClick={() => act("prepare")}>
        Load saved AI proposal
      </button>
    );
  } else if (screen >= 7 && screen <= 9) {
    const cfg = {
      7: { title: "You review it", button: "Record review", act: "review", learn: "A person decides. The AI only proposed." },
      8: { title: "You explain the bill", button: "Record explanation sent", act: "explain", learn: "You record that you explained it. The app sends nothing." },
      9: { title: "Haus 7 answers", button: "Record customer confirmation", act: "confirm", learn: "Closing the dispute does not mark the bill paid." },
    }[screen as 7 | 8 | 9];
    title = cfg.title;
    learn = cfg.learn;
    const draftNote = note ?? suggestedNote(item, screen);
    const last = item.work.history.at(-1);
    body = done ? (
      <div className={styles.card}><small>RECORDED</small><p>{item.work.history.find((h) => h.event === cfg.act)?.detail ?? last?.detail}</p></div>
    ) : (
      <>
        <textarea className={styles.note} value={draftNote} maxLength={600} onChange={(e) => setNote(e.target.value)} aria-label="Your note" aria-describedby="note-limit" />
        <p id="note-limit" className={styles.small}>{draftNote.length}/600 characters. Edit the suggested note before recording it.</p>
      </>
    );
    action = done ? null : (
      <button className={styles.primary} disabled={busy || !draftNote.trim()} onClick={() => act(cfg.act, { text: draftNote })}>
        {cfg.button}
      </button>
    );
  } else {
    title = "Demo complete: the dispute is closed";
    body = (
      <>
        <div className={styles.split2}>
          <div><small>HAUS 7 DISPUTE</small><b>{item.work.status === "closed_customer_confirmed" ? "Closed · customer confirmed" : "Closed after operator review · no customer confirmation"}</b></div>
          <div className={styles.amber}><small>HAUS 7 PAYMENT (REHEARSAL)</small><b>{item.payment.status === "not_sent" ? "Not sent · not paid" : item.payment.label}</b></div>
        </div>
        <p>
          You reviewed the archived PayPal payment results, then handled a separate fictional dispute. This rehearsal
          sent no invoices or payouts and did not settle a new month.
        </p>
        <p>Closing a dispute never marks a bill paid. Payment confirmation comes from a matching PayPal record.</p>
        <details className={styles.more}>
          <summary>Case timeline ({item.work.history.length} steps)</summary>
          <ol>{item.work.history.map((h, i) => <li key={i}><b>{h.event}</b> · {h.detail}</li>)}</ol>
        </details>
        <p className={styles.links}>
          See more: <Link href="/coop?source=evidence">operator desk with PayPal sandbox evidence</Link> ·{" "}
          <Link href="/coop/exceptions?source=holdout">AI agent evaluation</Link>
        </p>
      </>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Link href="/coop" className={styles.brand}>Solar Co-op</Link>
        <span>Public demo</span>
      </header>
      <section className={styles.panel}>
        {item && screen > 1 && (
          <div className={styles.progress} aria-label={screen === LAST ? "Finished" : `Step ${screen - 1} of ${TOTAL}`}>
            {Array.from({ length: TOTAL }, (_, i) => <i key={i} className={i < screen - 1 ? styles.on : undefined} />)}
            <span>{screen === LAST ? "Finished" : `Step ${screen - 1} of ${TOTAL}`}</span>
          </div>
        )}
        {tag && <p className={styles.tag}>{tag}</p>}
        <h1>{title}</h1>
        {body}
        {learn && <p className={styles.learn}><b>What this shows:</b> {learn}</p>}
        {busy && screen > 1 && <p role="status" className={styles.small}>Working… this can take a few seconds.</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.nav}>
          {item && screen > 2 ? <button className={styles.ghost} disabled={busy} onClick={() => { setNote(null); setScreen(screen - 1); }}>← Back</button> : <span />}
          {action}
          {item && screen > 1 && screen < LAST && (done || screen <= 4) && <button className={styles.primary} disabled={busy} onClick={next}>Next →</button>}
          {item && (screen === LAST ? (
            <button className={styles.primary} disabled={busy} onClick={() => startOver(false)}>{busy ? "Preparing…" : "↺ Start over"}</button>
          ) : screen > 1 ? (
            <button className={styles.ghost} disabled={busy} onClick={() => startOver(false)}>↺ Start over</button>
          ) : null)}
        </div>
      </section>
    </main>
  );
}
