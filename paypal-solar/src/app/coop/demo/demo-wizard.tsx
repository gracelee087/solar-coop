"use client";
import { useState } from "react";
import Link from "next/link";
import type { WorkbenchView, WorkItem } from "../../../lib/coop/workbench-types";
import styles from "./demo-wizard.module.css";

// Same value as src/lib/coop/demo.ts (not imported: that module uses the file system).
const DEMO_DRAFT = "bill-ST-202606-H07";
const TOTAL = 6;
const kwh = (wh: number) => (wh / 1000).toFixed(1);

/** The first screen whose step is not done yet, derived only from the Haus 7 case (8 = finished). */
export function firstOpenScreen(item: WorkItem | undefined, billRead: boolean): number {
  if (!item) return 1;
  const w = item.work;
  if (w.status.startsWith("closed")) return 8;
  if (!w.evidence?.length) return billRead ? 3 : 2;
  if (!w.proposal || item.proposalStale) return 4;
  if (w.status === "open") return 5;
  if (w.status === "explained_awaiting_reply") return 7;
  return 6;
}

export function evidenceText(item: WorkItem, period: string) {
  return `Fictional reply: the metering operator confirms ${kwh(item.chain?.meter?.consumptionWh ?? 0)} kWh for ${period}, matching the meter file.`;
}

export function suggestedNote(item: WorkItem, screen: number) {
  const a = item.chain?.allocation;
  if (screen === 5) return "Checked the split against the bill check and the metering operator's reply.";
  if (screen === 6)
    return a
      ? `Sent the explanation: ${kwh(a.receivedWh)} kWh shared solar on this bill, ${kwh(a.residualWh)} kWh from the household's own supplier.`
      : "Sent the explanation of the bill.";
  return "Customer replied: understood, no further questions.";
}

export default function DemoWizard({ initial }: { initial: WorkbenchView | null }) {
  const [view, setView] = useState(initial);
  const item = view?.items.find((i) => i.draftId === DEMO_DRAFT);
  const [billRead, setBillRead] = useState(false);
  const [screen, setScreen] = useState(() => firstOpenScreen(item, false));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = firstOpenScreen(item, billRead);
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
      setBillRead(false);
      setNote("");
      setScreen(2);
    }
  }
  const next = () => {
    if (screen === 2) setBillRead(true);
    setNote("");
    setScreen(screen + 1);
  };
  const done = screen < open;

  const c = item?.chain;
  const p = item?.work.proposal;
  let title = "";
  let body: React.ReactNode = null;
  let action: React.ReactNode = null;
  let learn = "";
  if (screen === 1 || !item) {
    title = "One customer dispute, end to end";
    body = (
      <>
        <p className={styles.lead}>
          Solar Co-op helps energy-sharing operators check bills, reconcile PayPal payments and handle customer disputes.
        </p>
        <p>
          In this demo you are the operator. Haus 7 says its meter shows more than its bill. In seven short steps you
          check the bill, add evidence, read the AI agent&apos;s proposal and record the outcome.
        </p>
        <p className={styles.small}>Your own offline copy. Fictional data. No PayPal call, no live AI call, nothing is sent.</p>
      </>
    );
    action = (
      <button className={styles.primary} disabled={busy} onClick={() => startOver(true)}>
        Start the demo →
      </button>
    );
  } else if (screen === 2) {
    title = "Haus 7 doubts its bill";
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
    action = done ? null : <button className={styles.primary} onClick={next}>Next →</button>;
  } else if (screen === 3) {
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
  } else if (screen === 4) {
    title = "The AI agent proposes";
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
      <p>The agent reads the statement, the bill check and both messages, then drafts checks and a reply.</p>
    );
    learn = "The AI drafts. Nothing is sent, and a person decides next.";
    action = done ? null : (
      <button className={styles.primary} disabled={busy} onClick={() => act("prepare")}>
        Ask the AI agent
      </button>
    );
  } else if (screen >= 5 && screen <= 7) {
    const cfg = {
      5: { title: "You review it", button: "Record review", act: "review", learn: "A person decides. The AI only proposed." },
      6: { title: "You explain the bill", button: "Record explanation sent", act: "explain", learn: "You record that you explained it. The app sends nothing." },
      7: { title: "Haus 7 answers", button: "Record customer confirmation", act: "confirm", learn: "Closing the dispute does not mark the bill paid." },
    }[screen as 5 | 6 | 7];
    title = cfg.title;
    learn = cfg.learn;
    const last = item.work.history.at(-1);
    body = done ? (
      <div className={styles.card}><small>RECORDED</small><p>{item.work.history.find((h) => h.event === cfg.act)?.detail ?? last?.detail}</p></div>
    ) : (
      <textarea className={styles.note} value={note || suggestedNote(item, screen)} maxLength={2000} onChange={(e) => setNote(e.target.value)} aria-label="Your note" />
    );
    action = done ? null : (
      <button className={styles.primary} disabled={busy} onClick={() => act(cfg.act, { text: note || suggestedNote(item, screen) })}>
        {cfg.button}
      </button>
    );
  } else {
    title = "Done: the dispute is closed";
    body = (
      <>
        <div className={styles.split2}>
          <div><small>DISPUTE</small><b>Closed · customer confirmed</b></div>
          <div className={styles.amber}><small>PAYMENT</small><b>Not sent · not paid</b></div>
        </div>
        <p>Two separate statuses: closing a dispute never marks a bill paid. Only a reconciled PayPal record does.</p>
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
          <div className={styles.progress} aria-label={screen > TOTAL + 1 ? "Finished" : `Step ${screen - 1} of ${TOTAL}`}>
            {Array.from({ length: TOTAL }, (_, i) => <i key={i} className={i < screen - 1 ? styles.on : undefined} />)}
            <span>{screen > TOTAL + 1 ? "Finished" : `Step ${screen - 1} of ${TOTAL}`}</span>
          </div>
        )}
        <h1>{title}</h1>
        {body}
        {learn && <p className={styles.learn}><b>What this shows:</b> {learn}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.nav}>
          {item && screen > 2 ? <button className={styles.ghost} onClick={() => { setNote(""); setScreen(screen - 1); }}>← Back</button> : <span />}
          {action}
          {done && screen < 8 && <button className={styles.primary} onClick={next}>Next →</button>}
          {item && (screen === 8 ? (
            <button className={styles.primary} disabled={busy} onClick={() => startOver(false)}>↺ Start over</button>
          ) : screen > 1 ? (
            <button className={styles.ghost} disabled={busy} onClick={() => startOver(false)}>↺ Start over</button>
          ) : null)}
        </div>
      </section>
    </main>
  );
}
